"use client"

import { useId, useState, type CSSProperties } from "react"
import {
  EmojiPicker,
  EmojiPickerCategories,
  EmojiPickerFooter,
  EmojiPickerList,
  EmojiPickerPanel,
  EmojiPickerPreview,
  EmojiPickerSearch,
  EmojiPickerSkinTone,
  type EmojiPickerI18nOverrides,
} from "@/components/reui/emoji-picker"

import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select"

type Locale = "en" | "de" | "fr" | "ja"

/* Emoji names, keywords and category labels come from each locale's data.
   These are the picker's own strings and the copy around it. No `panel`
   label: the card title names the panel instead. English needs no
   overrides, the picker's defaults are English. */
const LOCALES: Record<
  Locale,
  {
    name: string
    language: string
    title: string
    description: string
    i18n?: EmojiPickerI18nOverrides
  }
> = {
  en: {
    name: "English",
    language: "Language",
    title: "Status emoji",
    description: "Shown next to your name.",
  },
  de: {
    name: "Deutsch",
    language: "Sprache",
    title: "Status-Emoji",
    description: "Wird neben deinem Namen angezeigt.",
    i18n: {
      labels: {
        search: "Emoji suchen",
        clearSearch: "Suche löschen",
        list: "Emojis",
        categories: "Emoji-Kategorien",
        frequent: "Häufig verwendet",
        searchResults: "Suchergebnisse",
        skinTone: "Hautfarbe",
        skinTones: [
          "Standard",
          "Hell",
          "Mittelhell",
          "Mittel",
          "Mitteldunkel",
          "Dunkel",
        ],
        empty: "Keine Emojis gefunden",
        emptyHint: "Versuche ein anderes Wort",
        loading: "Emojis werden geladen",
        error: "Emojis konnten nicht geladen werden",
        retry: "Erneut versuchen",
        preview: "Wähle ein Emoji",
      },
      functions: {
        formatResultCount: (count) =>
          count === 1 ? "1 Emoji gefunden" : `${count} Emojis gefunden`,
        formatSelected: (label) => `${label} ausgewählt`,
      },
    },
  },
  fr: {
    name: "Français",
    language: "Langue",
    title: "Emoji de statut",
    description: "Affiché à côté de votre nom.",
    i18n: {
      labels: {
        search: "Rechercher un emoji",
        clearSearch: "Effacer la recherche",
        list: "Emojis",
        categories: "Catégories d'emojis",
        frequent: "Fréquemment utilisés",
        searchResults: "Résultats",
        skinTone: "Teint",
        skinTones: [
          "Par défaut",
          "Clair",
          "Moyennement clair",
          "Moyen",
          "Moyennement foncé",
          "Foncé",
        ],
        empty: "Aucun emoji trouvé",
        emptyHint: "Essayez un autre mot",
        loading: "Chargement des emojis",
        error: "Impossible de charger les emojis",
        retry: "Réessayer",
        preview: "Choisissez un emoji",
      },
      functions: {
        // French plurals start at 2; 0 and 1 stay singular.
        formatResultCount: (count) =>
          count > 1 ? `${count} emojis trouvés` : `${count} emoji trouvé`,
        // "Sélection" agrees with any label, where "sélectionné" would
        // need the emoji name's gender.
        formatSelected: (label) => `Sélection : ${label}`,
      },
    },
  },
  ja: {
    name: "日本語",
    language: "言語",
    title: "ステータスの絵文字",
    description: "名前の横に表示されます。",
    i18n: {
      labels: {
        search: "絵文字を検索",
        clearSearch: "検索をクリア",
        list: "絵文字",
        categories: "絵文字のカテゴリ",
        frequent: "よく使う絵文字",
        searchResults: "検索結果",
        skinTone: "肌の色",
        skinTones: ["標準", "明るい", "やや明るい", "中間", "やや暗い", "暗い"],
        empty: "絵文字が見つかりません",
        emptyHint: "別の言葉で検索してください",
        loading: "絵文字を読み込み中",
        error: "絵文字を読み込めませんでした",
        retry: "再試行",
        preview: "絵文字を選択",
      },
      functions: {
        formatResultCount: (count) => `${count}件の絵文字`,
        formatSelected: (label) => `${label}を選択しました`,
      },
    },
  },
}

const LOCALE_KEYS = Object.keys(LOCALES) as Locale[]

export function Pattern() {
  // Boots in German: the localized state is the point, not English.
  const [locale, setLocale] = useState<Locale>("de")
  // Controlled so a language switch can clear it: a French word searched
  // against Japanese data finds nothing.
  const [query, setQuery] = useState("")
  const titleId = useId()
  const { language, title, description, i18n } = LOCALES[locale]

  return (
    // `lang` switches the screen reader's voice and gives Japanese a
    // Japanese font. `pb-0` lets the picker's own footer close the card.
    <Card size="sm" className="w-full max-w-sm pb-0" lang={locale}>
      <CardHeader>
        <CardTitle id={titleId}>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        {/* In the card header, not the panel: a second tab bar would stack
            on the category tabs. A native select has the same API in both
            bases, and each name carries its own lang. */}
        <CardAction>
          <NativeSelect
            aria-label={language}
            value={locale}
            onChange={(event) => {
              setLocale(event.target.value as Locale)
              setQuery("")
            }}
          >
            {LOCALE_KEYS.map((key) => (
              <NativeSelectOption key={key} value={key} lang={key}>
                {LOCALES[key].name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </CardAction>
      </CardHeader>
      {/* Each language loads its own data once, shared by every picker on
          the page. `defaultValue` keeps the pick across a switch, so the
          footer shows it under its name in the new language. */}
      <EmojiPicker
        defaultValue={null}
        locale={locale}
        columns="auto"
        i18n={i18n}
        query={query}
        onQueryChange={setQuery}
        aria-labelledby={titleId}
      >
        {/* The panel takes the card's inset, so the title, the search, the
            first column and the footer share one edge in every style. The
            grid's gutter is that inset less a cell's own slack. The card's
            gap already spaces the search from the header, so it sits in a
            plain row, not the padded EmojiPickerHeader. */}
        <EmojiPickerPanel
          style={
            {
              "--emoji-picker-padding": "var(--card-spacing)",
              "--emoji-picker-gutter":
                "calc(var(--card-spacing) - (var(--emoji-picker-cell) - var(--emoji-picker-emoji)) / 2)",
            } as CSSProperties
          }
        >
          <div className="px-(--emoji-picker-padding) pb-2">
            <EmojiPickerSearch />
          </div>
          <EmojiPickerCategories />
          <EmojiPickerList />
          <EmojiPickerFooter>
            <EmojiPickerPreview />
            <EmojiPickerSkinTone />
          </EmojiPickerFooter>
        </EmojiPickerPanel>
      </EmojiPicker>
    </Card>
  )
}