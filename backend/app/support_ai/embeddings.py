"""Embedding generation service.

Only approved knowledge articles are embedded (plus the redacted query at search time). Claude has no
embeddings endpoint; Voyage AI is Anthropic's recommended provider. The "hash" provider is a
deterministic bag-of-words embedding so development and tests work offline. It is lexical, not
semantic, and the backend refuses to start with it when Claude is configured for production use.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import re
import urllib.error
import urllib.request

from sqlalchemy.orm import Session

from app.config import get_settings
from app.support_ai.models import EMBEDDING_DIM, KnowledgeArticle, KnowledgeEmbedding

log = logging.getLogger("app.support_ai.embeddings")
VOYAGE_URL = "https://api.voyageai.com/v1/embeddings"
TIMEOUT = 20


class EmbeddingError(Exception):
    def __init__(self, message: str, retryable: bool = True):
        super().__init__(message)
        self.retryable = retryable


def model_name() -> str:
    s = get_settings()
    return f"voyage:{s.voyage_model}:{EMBEDDING_DIM}" if s.embedding_provider == "voyage" else f"hash:v1:{EMBEDDING_DIM}"


_TOKEN = re.compile(r"[a-z0-9_]{2,}")


def _hash_embed(text: str) -> list[float]:
    vec = [0.0] * EMBEDDING_DIM
    tokens = _TOKEN.findall(text.lower())
    grams = tokens + [f"{a} {b}" for a, b in zip(tokens, tokens[1:])]
    for g in grams:
        h = hashlib.blake2b(g.encode(), digest_size=8).digest()
        idx = int.from_bytes(h[:4], "little") % EMBEDDING_DIM
        vec[idx] += 1.0 if h[4] & 1 else -1.0
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


def _voyage_embed(texts: list[str], input_type: str) -> list[list[float]]:
    s = get_settings()
    body = json.dumps({"input": texts, "model": s.voyage_model, "input_type": input_type, "output_dimension": EMBEDDING_DIM}).encode()
    req = urllib.request.Request(VOYAGE_URL, data=body, method="POST", headers={"Authorization": f"Bearer {s.voyage_api_key}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as res:  # noqa: S310 - fixed https URL
            data = json.loads(res.read())
    except urllib.error.HTTPError as e:
        raise EmbeddingError(f"Voyage answered {e.code}", retryable=e.code == 429 or e.code >= 500) from None
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise EmbeddingError(f"Couldn't reach Voyage: {getattr(e, 'reason', e)}") from None
    vectors = [d["embedding"] for d in sorted(data["data"], key=lambda d: d["index"])]
    if any(len(v) != EMBEDDING_DIM for v in vectors):
        raise EmbeddingError("Voyage returned an unexpected dimension", retryable=False)
    return vectors


def embed(texts: list[str], input_type: str = "document") -> list[list[float]]:
    """Embed already-redacted texts. input_type: "document" for articles, "query" for searches."""
    if get_settings().embedding_provider == "voyage":
        return _voyage_embed(texts, input_type)
    return [_hash_embed(t) for t in texts]


def article_text(a: KnowledgeArticle) -> str:
    return "\n".join([a.title, "Symptoms: " + a.symptoms, "Cause: " + a.root_cause, "Categories: " + ", ".join(a.categories or []), "Modules: " + ", ".join(a.modules or [])])


def embed_article(db: Session, article_id: str) -> str:
    """Embed one approved article (or drop its embedding if it is no longer approved). Commits."""
    a = db.get(KnowledgeArticle, article_id)
    existing = db.get(KnowledgeEmbedding, article_id)
    if a is None or a.status != "approved":
        if existing:
            db.delete(existing)
            db.commit()
        return "skipped"
    text = article_text(a)
    content_hash = hashlib.sha256(text.encode()).hexdigest()
    model = model_name()
    if existing and existing.model == model and existing.content_hash == content_hash:
        return "unchanged"
    vector = embed([text], "document")[0]
    if existing:
        existing.model, existing.content_hash, existing.embedding = model, content_hash, vector
    else:
        db.add(KnowledgeEmbedding(article_id=a.id, model=model, content_hash=content_hash, embedding=vector))
    db.commit()
    log.info("embedded article=%s model=%s", a.id, model)
    return "embedded"
