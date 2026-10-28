import sys; import os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pages_common import doc
EMAIL = '<a href="mailto:louisl4764@gmail.com">louisl4764@gmail.com</a>'
S = []
S.append(('who', 'Who we are', f'''        <p>Visionary ("Visionary", "we", "us") is a daily planning web app operated by Louis Liu, an independent developer based in Missouri, United States. For the purposes of data protection law, we are the controller of the personal information described in this policy.</p>
        <p>You can reach us at any time at {EMAIL}.</p>'''))
S.append(('collect', 'Information we collect', '''        <p>We collect only what we need to run Visionary. We never ask for sensitive categories of data, and you shouldn't put them into tasks or reflections.</p>
        <div class="doc-table-wrap"><table class="doc-table">
          <thead><tr><th scope="col">Category</th><th scope="col">What it includes</th><th scope="col">Where it comes from</th></tr></thead>
          <tbody>
            <tr><td>Account</td><td>Email address, a securely hashed password (we never see or store it in readable form), and, if you use Google sign-in, your name and profile picture URL.</td><td>You, or Google when you choose "Continue with Google"</td></tr>
            <tr><td>Your content</td><td>Tasks, categories, scheduled times, completion history, streaks, reflections (energy, focus and optional notes).</td><td>You</td></tr>
            <tr><td>AI requests</td><td>The tasks and recent reflection summaries sent with a Suggest or insight request, or a schedule image you choose to scan.</td><td>You, when you use an AI feature</td></tr>
            <tr><td>Security &amp; technical</td><td>Sign-in events, request timestamps, AI usage counts, and a one-way hash of your IP address used to detect abuse. Our hosting providers also keep short-lived server logs.</td><td>Automatically, when you use the service</td></tr>
            <tr><td>Analytics (optional)</td><td>Anonymous, aggregated page views and performance metrics (for example, page load time, device type, country). No cookies and no cross-site identifiers.</td><td>Automatically, only if you choose "Allow analytics"</td></tr>
            <tr><td>Messages</td><td>Anything you send us by email.</td><td>You</td></tr>
          </tbody>
        </table></div>'''))
S.append(('use', 'How we use it', '''        <ul>
          <li><strong>To provide the service</strong> — create your account, save and sync your data, and show your timeline, streaks and patterns. <em class="doc-basis">(Performance of our contract with you.)</em></li>
          <li><strong>To power the AI features you request</strong> — generate a suggestion, an insight, or a list of tasks from a schedule image. <em class="doc-basis">(Contract.)</em></li>
          <li><strong>To keep Visionary secure</strong> — prevent spam, brute-force sign-in attempts and abuse, enforce usage limits, and investigate incidents. <em class="doc-basis">(Our legitimate interest in protecting users and the service.)</em></li>
          <li><strong>To improve Visionary</strong> — understand, in aggregate, which pages are used and how fast they load. <em class="doc-basis">(Your consent, which you can withdraw at any time.)</em></li>
          <li><strong>To communicate with you</strong> — send account emails such as confirmation and password-reset links, and reply to your messages. <em class="doc-basis">(Contract and legitimate interest.)</em></li>
          <li><strong>To meet legal obligations</strong> — respond to lawful requests and enforce our Terms. <em class="doc-basis">(Legal obligation.)</em></li>
        </ul>
        <p>We do not use your content for advertising, we do not build advertising profiles, and we do not make decisions about you that have legal or similarly significant effects based solely on automated processing.</p>'''))
S.append(('ai', 'AI features', '''        <p>Suggest, reflection insights and Scan schedule are optional. When you use one, the relevant data is sent from our server to Anthropic's Claude API to generate a response, and the result is returned to you.</p>
        <ul>
          <li>Only the data needed for that request is sent: your current tasks, up to 14 days of reflection summaries, or the single image you selected.</li>
          <li>Images are resized and re-encoded in your browser before upload, which removes embedded metadata such as location. Visionary does not store the image after the scan finishes.</li>
          <li>Anthropic processes this data as our service provider. Under its commercial terms, API data is not used to train its models, and it is retained only as long as its data retention policy allows.</li>
          <li>AI output can be wrong. Treat it as a suggestion, not professional advice. Pattern cards on the Patterns page are calculated in your browser, not by AI.</li>
        </ul>'''))
S.append(('providers', 'Service providers', '''        <p>We share personal information only with the providers that help us run Visionary, under contracts that limit how they can use it:</p>
        <div class="doc-table-wrap"><table class="doc-table">
          <thead><tr><th scope="col">Provider</th><th scope="col">Purpose</th><th scope="col">Data involved</th></tr></thead>
          <tbody>
            <tr><td>Supabase</td><td>Database, authentication and server functions</td><td>Account, content, security data</td></tr>
            <tr><td>Vercel</td><td>Website hosting and delivery; optional cookie-free analytics</td><td>Technical data; anonymous analytics if you allow it</td></tr>
            <tr><td>Anthropic</td><td>AI suggestions, insights and schedule scanning</td><td>AI requests</td></tr>
            <tr><td>Google</td><td>"Continue with Google" sign-in, only if you use it</td><td>Account</td></tr>
            <tr><td>Cloudflare</td><td>Bot protection on sign-in forms (Turnstile), when enabled</td><td>Technical data</td></tr>
          </tbody>
        </table></div>
        <p>We may also disclose information if required by law, to protect the rights and safety of our users or others, or as part of a merger or transfer of the service, in which case this policy will continue to apply to your data.</p>'''))
S.append(('cookies', 'Cookies and browser storage', '''        <p>Visionary doesn't use advertising or cross-site tracking cookies. We use your browser's storage for the following:</p>
        <div class="doc-table-wrap"><table class="doc-table">
          <thead><tr><th scope="col">Name</th><th scope="col">Type</th><th scope="col">Purpose</th><th scope="col">Duration</th></tr></thead>
          <tbody>
            <tr><td>sb-…-auth-token</td><td>Local storage · essential</td><td>Keeps you signed in</td><td>Until you sign out</td></tr>
            <tr><td>vn_consent</td><td>Cookie · essential</td><td>Remembers your analytics choice (Secure, SameSite=Lax)</td><td>180 days</td></tr>
            <tr><td>visionary-theme, visionary-seen-version</td><td>Local storage · essential</td><td>Remembers light/dark mode and which release notes you've seen</td><td>Until cleared</td></tr>
            <tr><td>visionary-focus-…</td><td>Local storage · essential</td><td>Your focus-session log, stored only on this device</td><td>Until cleared</td></tr>
            <tr><td>vn-auth-attempts, vn-reset-sent-at</td><td>Local storage · essential</td><td>Security: slows down repeated sign-in and reset attempts</td><td>Up to a few hours</td></tr>
            <tr><td>Vercel Web Analytics &amp; Speed Insights</td><td>Script · optional</td><td>Anonymous, cookie-free usage and performance measurement</td><td>Loaded only after you allow it</td></tr>
          </tbody>
        </table></div>
        <p>You can change your choice at any time with <button type="button" class="link-inline" data-cookie-settings>Cookie settings</button>. We honor the Global Privacy Control signal: if your browser sends it, analytics stay off.</p>'''))
S.append(('retention', 'How long we keep data', '''        <ul>
          <li><strong>Account and content</strong> — for as long as your account is active. When you delete your account, it is removed from our active systems immediately and from backups within 30 days.</li>
          <li><strong>Security logs</strong> — up to 180 days, unless we need them longer to investigate a specific incident.</li>
          <li><strong>AI usage counters</strong> — up to 90 days.</li>
          <li><strong>Schedule images</strong> — not stored by Visionary after processing.</li>
          <li><strong>Emails with us</strong> — as long as needed to resolve your request.</li>
        </ul>'''))
S.append(('security', 'How we protect your data', '''        <p>All traffic is encrypted with HTTPS, and browsers are instructed to use HTTPS only (HSTS). Passwords are hashed by our authentication provider. Database rules ensure every account can read and change only its own records. We limit request sizes and AI usage, restrict which websites can call our servers, block repeated sign-in attempts, and log security events.</p>
        <p>No system is perfectly secure. If we learn of a breach that affects your personal information, we will notify you and the relevant authorities as required by law. To report a vulnerability, email us. Our security contact is also listed at <a href="/.well-known/security.txt">/.well-known/security.txt</a>.</p>'''))
S.append(('rights', 'Your rights and choices', f'''        <p>Wherever you live, you can:</p>
        <ul>
          <li><strong>Access and export</strong> your data at any time from <strong>Account → Download my data</strong>.</li>
          <li><strong>Correct</strong> your data by editing it in the app.</li>
          <li><strong>Delete</strong> your account and all associated data from <strong>Account → Delete account</strong>, or by emailing us.</li>
          <li><strong>Withdraw consent</strong> to analytics with Cookie settings.</li>
          <li><strong>Object</strong> to or ask us to restrict certain processing.</li>
        </ul>
        <p><strong>California residents.</strong> Under the CCPA/CPRA you have the right to know, delete, and correct personal information, and to not be discriminated against for exercising these rights. We do not sell or share personal information for cross-context behavioral advertising, and we do not use sensitive personal information to infer characteristics about you.</p>
        <p><strong>EEA, UK and Swiss residents.</strong> You also have the right to data portability and to lodge a complaint with your local data protection authority.</p>
        <p>To make a request, email {EMAIL} from the address on your account. We will respond within 30 days (45 days where California law allows) and may need to verify your identity first. If we decline your request, you may appeal by replying to our decision.</p>'''))
S.append(('children', 'Children', '''        <p>Visionary is not directed to children under 13, and we do not knowingly collect personal information from them. If you are between 13 and the age of majority where you live, you may use Visionary only with permission from a parent or guardian. If you believe a child under 13 has created an account, contact us and we will delete it.</p>'''))
S.append(('international', 'International users', '''        <p>Visionary is operated from the United States, and our providers may process data in the United States and other countries. Where required, we rely on appropriate safeguards, such as the European Commission's Standard Contractual Clauses offered by our providers, for transfers of personal data.</p>'''))
S.append(('changes', 'Changes to this policy', '''        <p>We will update this policy when our practices change. If a change is material, we will tell you in the app or by email before it takes effect. The date at the top shows when it was last updated.</p>'''))
S.append(('contact', 'Contact', f'''        <p>Questions, requests or concerns: {EMAIL}. We aim to reply within a few business days.</p>'''))

summary = '''        <ul>
          <li>We collect your email, the tasks and reflections you create, and basic security data. That's it.</li>
          <li>We never sell your data or use it for ads.</li>
          <li>AI features only run when you use them, and schedule images aren't stored.</li>
          <li>Analytics are anonymous, cookie-free, and off unless you allow them.</li>
          <li>You can download or permanently delete your data from the app at any time.</li>
        </ul>'''
html = doc('Privacy Policy — Visionary', 'How Visionary collects, uses and protects your information, and the choices you have.', '/privacy', 'privacy',
           'Privacy Policy', '<span>Effective September 28, 2026</span><span>Last updated September 28, 2026</span>',
           'Visionary helps you plan your day. This policy explains, in plain language, what information we collect, why, who we share it with, and how you stay in control.', summary, S)
open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'privacy.html'), 'w').write(html)
print(len(html))
