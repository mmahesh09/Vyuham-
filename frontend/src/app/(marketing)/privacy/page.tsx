import type { Metadata } from "next";
import Link from "next/link";

import { Logo } from "@/components/layout/logo";
import { PRIVACY_VERSION } from "@/lib/legal";

/*
 * ─── FILL THESE IN BEFORE LAUNCH ──────────────────────────────────────────────
 * The DPDP Act requires a named Data Fiduciary and a reachable grievance contact.
 * Have a lawyer review this page before it goes live.
 */
const LEGAL = {
  entity: "[Registered company name]",
  address: "[Registered office address, India]",
  grievanceOfficer: "[Name of Grievance Officer]",
  grievanceEmail: "[privacy@your-domain]",
  hosting: "[Hosting region, e.g. India (Mumbai)]",
};
// Bump PRIVACY_VERSION in src/lib/legal.ts when this page changes.
const UPDATED = "9 November 2026";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How Vyuham collects, uses and protects personal data under India's Digital Personal Data Protection Act, 2023. We never collect card numbers and never sell or train AI on your data.",
};

const SECTIONS = [
  ["summary", "The short version"],
  ["roles", "Who is responsible for what"],
  ["collect", "What we collect"],
  ["never", "What we never collect or do"],
  ["charts", "How we use chart and dashboard data"],
  ["ai", "AI features"],
  ["purposes", "Why we process data"],
  ["sharing", "Who we share data with"],
  ["retention", "How long we keep data"],
  ["rights", "Your rights under the DPDP Act"],
  ["security", "Security and breaches"],
  ["children", "Children"],
  ["cookies", "Cookies"],
  ["transfers", "Where data is stored"],
  ["changes", "Changes to this policy"],
  ["contact", "Grievance Officer and contact"],
] as const;

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-24 pt-4 font-display text-[24px] font-semibold leading-tight text-text">
      {children}
    </h2>
  );
}

const p = "text-[15.5px] leading-[1.75] text-muted";
const li = "text-[15.5px] leading-[1.7] text-muted";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-[1080px] items-center justify-between px-5 py-5">
          <Logo href="/" />
          <Link href="/signup" className="text-sm font-medium text-highlight hover:underline">
            Join the beta
          </Link>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1080px] gap-12 px-5 pb-24 pt-12 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="On this page" className="hidden lg:block">
          <ul className="sticky top-8 flex flex-col gap-2 text-[13px]">
            {SECTIONS.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="text-faint hover:text-text">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <article className="flex min-w-0 max-w-[72ch] flex-col gap-5">
          <div className="flex flex-col gap-3">
            <p className="text-sm text-faint">Last updated {UPDATED} · Version {PRIVACY_VERSION}</p>
            <h1 className="font-display text-[clamp(34px,5vw,48px)] font-semibold leading-[1.05] tracking-tight">Privacy Policy</h1>
            <p className={p}>
              This policy explains how {LEGAL.entity} (&ldquo;Vyuham&rdquo;, &ldquo;we&rdquo;) handles personal data when you use
              vyuham and its website. It is written to meet India&apos;s <strong className="text-text">Digital Personal Data Protection Act, 2023</strong>{" "}
              (&ldquo;DPDP Act&rdquo;) and the <strong className="text-text">Digital Personal Data Protection Rules, 2025</strong>. In those laws,
              you are the <em>Data Principal</em> and, for your account data, we are the <em>Data Fiduciary</em>.
            </p>
          </div>

          {/* ---------- Summary ---------- */}
          <section id="summary" aria-labelledby="summary-h" className="scroll-mt-24 rounded-[18px] border border-line bg-surface p-6">
            <h2 id="summary-h" className="mb-4 font-display text-[20px] font-semibold">
              The short version
            </h2>
            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <p className="mb-2 text-sm font-semibold text-highlight">What we use</p>
                <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[14.5px] text-muted">
                  <li>Your name, work email and company, to run your account</li>
                  <li>The spreadsheets you upload, only to build <em>your</em> charts</li>
                  <li>How the charts and dashboards are used (which chart types, filters and views), to improve the product</li>
                </ul>
              </div>
              <div>
                <p className="mb-2 text-sm font-semibold text-accent">What we never do</p>
                <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[14.5px] text-muted">
                  <li>Collect or store card numbers, CVV or UPI PINs</li>
                  <li>Sell or rent anyone&apos;s personal data</li>
                  <li>Mine your customers&apos; personal details from your files</li>
                  <li>Use your data for advertising or to train AI models</li>
                </ul>
              </div>
            </div>
          </section>

          <H2 id="roles">1. Who is responsible for what</H2>
          <p className={p}>There are two kinds of personal data in Vyuham, and the DPDP Act treats them differently:</p>
          <ul className="flex list-disc flex-col gap-2 pl-5">
            <li className={li}>
              <strong className="text-text">Your account data</strong> (your name, email, profile and how you use the app). We decide why
              and how it is processed, so we are its <strong className="text-text">Data Fiduciary</strong>.
            </li>
            <li className={li}>
              <strong className="text-text">Data inside the files you upload</strong>. A spreadsheet may contain your own customers&apos;,
              employees&apos; or suppliers&apos; details. Your organisation decides what goes in and why, so your organisation is the Data
              Fiduciary for it. We process it <strong className="text-text">only on your instructions</strong>, as your{" "}
              <strong className="text-text">Data Processor</strong> (section 8(2) of the DPDP Act), to show you your charts and
              answers. You are responsible for having a lawful basis to upload it. We recommend leaving out columns you don&apos;t need
              for reporting, such as phone numbers, addresses or ID numbers.
            </li>
          </ul>

          <H2 id="collect">2. What we collect</H2>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[560px] text-left text-[14px]">
              <thead className="bg-surface text-text">
                <tr>
                  <th className="px-4 py-3 font-semibold">Data</th>
                  <th className="px-4 py-3 font-semibold">Examples</th>
                  <th className="px-4 py-3 font-semibold">Why</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line text-muted">
                {[
                  ["Account", "Name, work email, company name, password (stored only as a one-way hash), Google or Apple sign-in ID if you use it", "Creating and securing your account"],
                  ["Profile and team", "Role, phone number, time zone, working hours, signature image, status (Available, Busy, On leave…), leave type (sick, casual or paid), leave dates and backup person", "Showing teammates who you are, when you're available and who covers for you"],
                  ["Uploaded data", "CSV and Excel files, the columns detected in them, and the tables we build from them", "Building your charts, dashboards and answers"],
                  ["Chart and dashboard usage", "Chart types you create, filters and date ranges you apply, dashboards you open, features you click", "Improving the product (see section 4)"],
                  ["Technical", "IP address, browser and device type stored with your sign-in session, error logs", "Keeping you signed in, preventing fraud and abuse, fixing bugs"],
                  ["Team and tasks", "Invite links (and the invitee's email if you type one), workspace roles, data tasks: title, details, assignee, priority, dates and the dataset or dashboard they're about", "Letting teams work together on their data"],
                  ["Alerts, automations and SQL", "Alert rules and their history, digest schedules, the emails and webhook URLs you add, saved SQL queries", "Notifying you about your numbers and saving your work"],
                  ["Feedback", "Star ratings and comments you send us", "Improving the product"],
                ].map(([a, b, c]) => (
                  <tr key={a}>
                    <td className="px-4 py-3 align-top font-medium text-text">{a}</td>
                    <td className="px-4 py-3 align-top">{b}</td>
                    <td className="px-4 py-3 align-top">{c}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={p}>
            For leave we record only the <em>type</em> (sick, casual or paid) and the dates. We never ask for medical reasons, diagnoses or
            certificates. Please don&apos;t put them in the handover note.
          </p>

          <H2 id="never">3. What we never collect or do</H2>
          <ul className="flex list-disc flex-col gap-2 pl-5">
            <li className={li}>
              <strong className="text-text">No card or payment credentials.</strong> Vyuham is free during the beta and takes no payments.
              When paid plans start, payments will be handled entirely by an RBI-authorised, PCI-DSS compliant payment gateway. Your card
              number, CVV, UPI PIN and net-banking passwords go straight to them and never reach our servers. We will only receive the
              payment status, plan, amount, and things like the card network and last four digits so you can recognise the payment.
            </li>
            <li className={li}>
              <strong className="text-text">We don&apos;t use your customers&apos; personal information.</strong> We don&apos;t look up,
              profile, contact, enrich or build lists from the people whose details appear in your uploaded files. Their data is used for one
              thing only: computing <em>your</em> charts, totals and answers.
            </li>
            <li className={li}>
              <strong className="text-text">No selling, no advertising.</strong> We don&apos;t sell, rent or trade personal data, and we
              don&apos;t use it for targeted advertising or behavioural monitoring.
            </li>
            <li className={li}>
              <strong className="text-text">No AI training on your data.</strong> Neither we nor our AI provider use your uploaded data or
              account data to train AI models.
            </li>
            <li className={li}>
              <strong className="text-text">No tracking cookies</strong> and no third-party advertising or analytics scripts (see section 12).
            </li>
          </ul>

          <H2 id="charts">4. How we use chart and dashboard data</H2>
          <p className={p}>
            To improve Vyuham we look at <strong className="text-text">how the product is used, not at what is inside your data</strong>.
            This includes which chart types are built, which filters, date ranges and templates are used, which suggested charts are kept or
            removed, how long dashboards take to load, and where errors happen.
          </p>
          <p className={p}>
            These product insights are recorded about the charts themselves (for example &ldquo;a bar chart grouped by month with a region
            filter&rdquo;). They do <strong className="text-text">not</strong> include the values or rows from your files, or the names,
            numbers or other personal details in them. Where we look at usage across many workspaces, we use aggregated figures that
            don&apos;t identify any person.
          </p>

          <H2 id="ai">5. AI features</H2>
          <p className={p}>
            Some features, like suggested charts, plain-English answers and insight summaries, use a third-party AI model (Anthropic&apos;s
            Claude). These features are rolling out during the beta. When they are on, we keep personal data out of the model as far as
            possible:
          </p>
          <ul className="flex list-disc flex-col gap-2 pl-5">
            <li className={li}>
              We send column names, column types, a few example values per column, your question, and the{" "}
              <strong className="text-text">totals and summaries</strong> that we calculate on our own servers. We don&apos;t send your full
              file.
            </li>
            <li className={li}>The AI provider processes this only to produce your answer, under a contract that forbids training on it.</li>
            <li className={li}>The numbers in answers are calculated by our database, not invented by the AI. The AI only writes the explanation.</li>
          </ul>

          <H2 id="purposes">6. Why we process data (lawful basis)</H2>
          <p className={p}>Under the DPDP Act we process personal data on one of two grounds:</p>
          <ul className="flex list-disc flex-col gap-2 pl-5">
            <li className={li}>
              <strong className="text-text">Your consent</strong> (section 6), which you give when you create an account, for running your
              account, your profile features, chart usage insights and AI features. You can withdraw it at any time, as easily as you gave
              it (see section 9).
            </li>
            <li className={li}>
              <strong className="text-text">Legitimate uses</strong> (section 7), where the law allows processing without separate consent,
              such as using data you gave us voluntarily for the purpose you gave it for, meeting legal obligations, and responding to legal
              requests.
            </li>
          </ul>
          <p className={p}>
            We collect only what we need for these purposes (data minimisation) and won&apos;t use your data for a new purpose without
            telling you and, where required, asking again.
          </p>

          <H2 id="sharing">7. Who we share data with</H2>
          <ul className="flex list-disc flex-col gap-2 pl-5">
            <li className={li}>
              <strong className="text-text">People in your workspace</strong> see your name, role, status, leave and backup, the
              data tasks assigned to you or created by you, and the dashboards you share with them. If you choose &ldquo;Anyone with the link&rdquo; for a dashboard, anyone with that link can
              view it.
            </li>
            <li className={li}>
              <strong className="text-text">Service providers (Data Processors)</strong> who help us run Vyuham, such as cloud hosting, the
              AI provider, email delivery and, later, the payment gateway. They act only on our instructions, under contracts that require
              DPDP-level protection.
            </li>
            <li className={li}>
              <strong className="text-text">Places you choose to send alerts to.</strong> If you set up an alert or automation with an
              email address or a webhook (for example Slack, Microsoft Teams or Zapier), the alert text or dashboard headlines are sent
              there. That service&apos;s own privacy terms then apply to what it receives.
            </li>
            <li className={li}>
              <strong className="text-text">Authorities</strong>, when Indian law requires it, for example a lawful request from the
              Government or the Data Protection Board of India.
            </li>
          </ul>

          <H2 id="retention">8. How long we keep data</H2>
          <ul className="flex list-disc flex-col gap-2 pl-5">
            <li className={li}>Account and profile data: while your account is active.</li>
            <li className={li}>Uploaded files and the tables built from them: until you delete them or your account.</li>
            <li className={li}>Leave history: while your account is active, so you and your team have a record.</li>
            <li className={li}>Data tasks: while the workspace exists. If someone leaves the workspace, their tasks stay but become unassigned.</li>
            <li className={li}>Invite links: until used, revoked or expired (7 days).</li>
            <li className={li}>
              When you delete your account, or the purpose is over, we erase your personal data, except what the law requires us to keep.
              Security logs (sign-in and access records) are kept for <strong className="text-text">one year</strong>, as the DPDP Rules,
              2025 require, and then deleted.
            </li>
          </ul>

          <H2 id="rights">9. Your rights under the DPDP Act</H2>
          <p className={p}>As a Data Principal you have the right to:</p>
          <ul className="flex list-disc flex-col gap-2 pl-5">
            <li className={li}>
              <strong className="text-text">Access</strong> (section 11): a summary of the personal data we hold about you, what we do with
              it, and who we have shared it with.
            </li>
            <li className={li}>
              <strong className="text-text">Correction, completion, updating and erasure</strong> (section 12). You can edit most details
              yourself on your Profile page.
            </li>
            <li className={li}>
              <strong className="text-text">Withdraw consent</strong> (section 6(4)) at any time. This doesn&apos;t affect processing that
              already happened. Some features may stop working, and withdrawing consent for the core service means closing your account.
            </li>
            <li className={li}>
              <strong className="text-text">Grievance redressal</strong> (section 13): complain to our Grievance Officer (section 15). We
              will respond within <strong className="text-text">90 days</strong>, as the DPDP Rules require, and usually much sooner.
            </li>
            <li className={li}>
              <strong className="text-text">Nominate</strong> (section 14) someone to exercise these rights for you if you die or become
              unable to act.
            </li>
            <li className={li}>
              <strong className="text-text">Complain to the Data Protection Board of India</strong> if you&apos;re not satisfied with our
              response, after first using our grievance process.
            </li>
          </ul>
          <p className={p}>
            To use any of these rights, email {LEGAL.grievanceEmail} from your account email. We may ask you to confirm your identity before
            acting. If your data came to us inside an organisation&apos;s uploaded file, please contact that organisation first. They are the
            Data Fiduciary, and we will help them respond.
          </p>
          <p className={p}>
            The DPDP Act also places duties on Data Principals: please give us accurate information, don&apos;t impersonate anyone, and
            don&apos;t file false or frivolous complaints.
          </p>

          <H2 id="security">10. Security and breaches</H2>
          <p className={p}>
            We take reasonable security safeguards as section 8(5) requires: encryption in transit (HTTPS), passwords stored only as salted
            hashes, separation of each workspace&apos;s data, access limited to staff who need it, and logs to detect misuse.
          </p>
          <p className={p}>
            If a personal data breach happens, we will inform the <strong className="text-text">Data Protection Board of India</strong> and
            every affected user without delay, as section 8(6) and the DPDP Rules require. We will tell you what happened, what data was
            involved, the likely impact, what we are doing about it, and what you can do to protect yourself.
          </p>

          <H2 id="children">11. Children</H2>
          <p className={p}>
            Vyuham is a business tool for adults. You must be 18 or older to create an account, and we don&apos;t knowingly process the
            personal data of children (under 18 under the DPDP Act). If you believe a child has signed up, contact us and we will delete the
            account. If your uploaded files contain children&apos;s data, your organisation must have verifiable consent from a parent or
            lawful guardian, as section 9 requires.
          </p>

          <H2 id="cookies">12. Cookies</H2>
          <p className={p}>
            We use one essential cookie, the sign-in session cookie that keeps you logged in. It expires after 7 days without use or when you
            log out. We don&apos;t use advertising cookies, tracking pixels or third-party analytics cookies.
          </p>

          <H2 id="transfers">13. Where data is stored</H2>
          <p className={p}>
            Your data is stored in {LEGAL.hosting}. Some service providers, such as the AI provider, may process data outside India. The DPDP
            Act allows this except to countries the Central Government restricts, and we will not transfer data to any restricted country.
          </p>

          <H2 id="changes">14. Changes to this policy</H2>
          <p className={p}>
            When this policy changes, we will update the date and version at the top. For significant changes we will email you or show a
            notice in the app before they take effect, and ask for your consent again where the law requires it.
          </p>

          <H2 id="contact">15. Grievance Officer and contact</H2>
          <div className="rounded-xl border border-line bg-surface p-5 text-[15px] leading-relaxed text-muted">
            <p className="font-semibold text-text">{LEGAL.entity}</p>
            <p>{LEGAL.address}</p>
            <p className="mt-3">
              Grievance Officer: <span className="text-text">{LEGAL.grievanceOfficer}</span>
            </p>
            <p>
              Email: <span className="text-highlight">{LEGAL.grievanceEmail}</span>
            </p>
          </div>
        </article>
      </main>
    </div>
  );
}
