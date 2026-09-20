import { Link, useNavigate } from 'react-router-dom'
import './InfoPage.css'

// Public legal page: MingleMate Terms of Service.
// Verbatim operator-supplied agreement; bracketed values are
// deliberate placeholders the operator must fill before relying
// on this document. Processed under Kenyan law per clause 30.
export default function Terms() {
  const navigate = useNavigate()

  return (
    <div className="info-page">
      <nav className="info-nav">
        <Link to="/" className="info-logo" style={{ textDecoration: 'none' }}>MingleMate</Link>
        <button className="info-cta" onClick={() => navigate('/signup')}>Sign Up</button>
      </nav>

      <main className="info-main">
        <h1>MingleMate Terms of Service</h1>
        <p className="info-lede">User Agreement</p>

        <p className="legal-note">
          Effective Date: [INSERT DATE]<br />
          Last Updated: [INSERT DATE]
        </p>

        <p>Welcome to <strong>MingleMate</strong>.</p>
        <p>
          These Terms of Service ("Terms", "Agreement") govern your access to and use of the
          MingleMate website, application, platform, services and related features ("MingleMate",
          the "Platform", "Service", "we", "us" or "our").
        </p>
        <p>
          By creating an account, accessing the Platform, using its features, or otherwise
          indicating your acceptance of these Terms, you enter into a legally binding agreement
          with MingleMate.
        </p>
        <p><strong>If you do not agree to these Terms, do not create an account or use MingleMate.</strong></p>

        <h2>1. What MingleMate Is</h2>
        <p>
          MingleMate is a social and relationship-matching platform designed to help adults discover
          people who may have compatible communication styles, relationship expectations, values,
          lifestyles and other preferences.
        </p>
        <p>MingleMate may provide features including:</p>
        <ul>
          <li>user profiles;</li>
          <li>compatibility questions and assessments;</li>
          <li>compatibility results or indicators;</li>
          <li>profile discovery;</li>
          <li>matching or recommendation features;</li>
          <li>messaging or communication features;</li>
          <li>profile photographs and other user-generated content;</li>
          <li>account and profile-management tools; and</li>
          <li>other features introduced by MingleMate from time to time.</li>
        </ul>
        <p>MingleMate is a <strong>platform for discovering and communicating with other people</strong>.</p>
        <p>MingleMate does not guarantee that you will:</p>
        <ul>
          <li>find a romantic partner;</li>
          <li>receive a match;</li>
          <li>establish a relationship;</li>
          <li>have a successful relationship with another user;</li>
          <li>meet another user in person; or</li>
          <li>achieve any particular personal or relationship outcome.</li>
        </ul>
        <p>
          Compatibility results and recommendations are informational tools. They are not
          psychological, medical, professional or scientific diagnoses and should not be treated as
          guarantees of interpersonal compatibility.
        </p>

        <h2>2. Eligibility</h2>
        <h3>2.1 Minimum age</h3>
        <p>MingleMate is intended <strong>only for persons aged 18 years or older</strong>.</p>
        <p>By creating an account, you represent and warrant that:</p>
        <ol>
          <li>you are at least 18 years old;</li>
          <li>you have the legal capacity to enter into this Agreement; and</li>
          <li>the information you provide concerning your age is accurate.</li>
        </ol>
        <p>MingleMate does not knowingly permit persons under 18 to create or maintain accounts.</p>
        <p>
          If we reasonably believe that an account belongs to a person under 18, we may suspend or
          terminate that account and take appropriate steps concerning associated information.
        </p>
        <h3>2.2 One person, one account</h3>
        <p>Unless MingleMate expressly permits otherwise, you may maintain only one personal MingleMate account.</p>
        <p>You may not create an account for another person without their authorization.</p>

        <h2>3. Creating Your Account</h2>
        <p>You agree to provide information that is accurate, current and not misleading.</p>
        <p>You are responsible for:</p>
        <ul>
          <li>the information contained in your profile;</li>
          <li>maintaining the security of your login credentials;</li>
          <li>activity conducted through your account; and</li>
          <li>notifying MingleMate if you believe your account has been compromised.</li>
        </ul>
        <p>You must not impersonate another person or create a misleading identity.</p>
        <p>You must not use another person's photographs, personal information or other identifying material without appropriate authorization.</p>
        <p>MingleMate may request information reasonably necessary to verify an account, investigate abuse, protect users or comply with applicable law.</p>

        <h2>4. Your Profile</h2>
        <p>You control the information you choose to place on your profile, subject to these Terms and our Privacy Policy.</p>
        <p>You should carefully consider what information you make publicly or privately available.</p>
        <p><strong>Do not publish information that you would not want strangers to possess.</strong></p>
        <p>This includes, where possible:</p>
        <ul>
          <li>passwords;</li>
          <li>financial information;</li>
          <li>identity-document numbers;</li>
          <li>banking information;</li>
          <li>precise home addresses;</li>
          <li>private workplace information;</li>
          <li>private contact information; or</li>
          <li>other information that could expose you to unnecessary risk.</li>
        </ul>
        <p>You are responsible for ensuring that your profile does not contain unlawful, fraudulent, abusive, defamatory or otherwise prohibited material.</p>

        <h2>5. Compatibility Questions and Matching</h2>
        <p>MingleMate may ask users questions concerning subjects such as:</p>
        <ul>
          <li>communication;</li>
          <li>conflict;</li>
          <li>emotional maturity;</li>
          <li>relationship expectations;</li>
          <li>personal values;</li>
          <li>lifestyle;</li>
          <li>personal preferences; and</li>
          <li>other factors relevant to relationship compatibility.</li>
        </ul>
        <p>Your answers may be processed to generate compatibility indicators, recommendations, matches or other platform features.</p>
        <p>You acknowledge that:</p>
        <ol>
          <li>your answers may be subjective;</li>
          <li>people can change their views and behaviour;</li>
          <li>users may misunderstand or misrepresent themselves;</li>
          <li>compatibility calculations depend on the information available to MingleMate;</li>
          <li>algorithms and scoring systems cannot predict human relationships with certainty; and</li>
          <li>a compatibility result does not establish that two people are suitable partners.</li>
        </ol>
        <p>You should independently evaluate another person's behaviour, statements and conduct.</p>
        <p>You remain responsible for deciding whether and how to communicate or meet another user.</p>

        <h2>6. Matching Does Not Mean Endorsement</h2>
        <p>A match, recommendation, compatibility score, ranking, profile suggestion or similar result does <strong>not</strong> mean that MingleMate:</p>
        <ul>
          <li>has verified the person's identity;</li>
          <li>has verified their background;</li>
          <li>guarantees their statements are true;</li>
          <li>endorses the person;</li>
          <li>guarantees their safety;</li>
          <li>recommends entering into a relationship with them; or</li>
          <li>guarantees that the person is suitable for you.</li>
        </ul>
        <p>You should exercise reasonable judgment when interacting with other users.</p>

        <h2>7. Communication Between Users</h2>
        <p>MingleMate may provide messaging, contact or communication functionality.</p>
        <p>You are responsible for your communications with other users.</p>
        <p>You must not use MingleMate communication features to:</p>
        <ul>
          <li>threaten another person;</li>
          <li>harass or intimidate another person;</li>
          <li>stalk another person;</li>
          <li>repeatedly contact someone who has asked you to stop;</li>
          <li>send sexually explicit material without consent;</li>
          <li>distribute malicious software;</li>
          <li>conduct fraud or scams;</li>
          <li>solicit money through deception;</li>
          <li>impersonate another person;</li>
          <li>distribute another person's private information without authorization; or</li>
          <li>engage in any other unlawful or abusive conduct.</li>
        </ul>
        <p>If another user makes you uncomfortable, you should stop communicating with them and use available blocking or reporting features.</p>

        <h2>8. Meeting Other Users</h2>
        <p>MingleMate is an online platform.</p>
        <p>If you choose to meet another user in person, <strong>that decision is yours</strong>.</p>
        <p>MingleMate does not arrange or supervise private meetings between users and does not guarantee the identity, intentions, background, behaviour or safety of any user.</p>
        <p>Users should exercise appropriate caution when meeting someone they first encountered online.</p>
        <p>Where reasonably possible, consider:</p>
        <ul>
          <li>meeting in a public location;</li>
          <li>informing someone you trust about your plans;</li>
          <li>arranging your own transportation;</li>
          <li>avoiding unnecessary disclosure of private information; and</li>
          <li>leaving if a situation becomes uncomfortable or unsafe.</li>
        </ul>
        <p>MingleMate is not responsible for conduct occurring between users outside the Platform, except to the extent responsibility cannot lawfully be excluded.</p>

        <h2>9. Prohibited Conduct</h2>
        <p>You must not use MingleMate to:</p>

        <h3>9.1 Fraud and deception</h3>
        <ul>
          <li>scam or defraud another person;</li>
          <li>request money through fraudulent representations;</li>
          <li>create fake identities for deceptive purposes;</li>
          <li>impersonate another person or organization;</li>
          <li>manipulate users through deliberate deception; or</li>
          <li>facilitate financial crime.</li>
        </ul>

        <h3>9.2 Abuse and harassment</h3>
        <ul>
          <li>threaten violence;</li>
          <li>harass or intimidate another user;</li>
          <li>stalk another person;</li>
          <li>engage in targeted abuse;</li>
          <li>repeatedly contact a person after being asked to stop;</li>
          <li>publish another person's private information without authorization; or</li>
          <li>encourage another person to harm themselves or others.</li>
        </ul>

        <h3>9.3 Sexual misconduct</h3>
        <ul>
          <li>use MingleMate to exploit or abuse another person;</li>
          <li>distribute sexual content without consent;</li>
          <li>engage in sexual exploitation;</li>
          <li>solicit sexual services where prohibited by law;</li>
          <li>facilitate sexual exploitation of another person; or</li>
          <li>involve persons under 18 in sexual activity or sexual content.</li>
        </ul>

        <h3>9.4 Illegal activity</h3>
        <p>You may not use MingleMate to facilitate or promote conduct that violates applicable law.</p>

        <h3>9.5 Platform abuse</h3>
        <p>You may not:</p>
        <ul>
          <li>interfere with the operation of MingleMate;</li>
          <li>attempt unauthorized access;</li>
          <li>bypass security controls;</li>
          <li>scrape substantial amounts of Platform data without authorization;</li>
          <li>reverse engineer the Platform except where applicable law expressly permits it;</li>
          <li>introduce malicious code;</li>
          <li>overload or disrupt the Platform;</li>
          <li>circumvent account restrictions; or</li>
          <li>use automated systems to abuse the Service.</li>
        </ul>

        <h2>10. User-Generated Content</h2>
        <p>You may submit, upload, publish or transmit content through MingleMate, including:</p>
        <ul>
          <li>photographs;</li>
          <li>profile descriptions;</li>
          <li>answers;</li>
          <li>messages;</li>
          <li>comments;</li>
          <li>other text;</li>
          <li>audio or visual material; and</li>
          <li>other information ("User Content").</li>
        </ul>
        <p>You retain ownership of your User Content, subject to the rights granted in this Agreement.</p>
        <p>You represent that:</p>
        <ol>
          <li>you have the necessary rights to submit the content;</li>
          <li>the content does not unlawfully infringe another person's rights;</li>
          <li>the content is not fraudulent or deliberately misleading;</li>
          <li>the content does not violate these Terms; and</li>
          <li>MingleMate's use of the content as contemplated by this Agreement will not violate applicable law.</li>
        </ol>

        <h2>11. Licence to MingleMate</h2>
        <p>
          When you upload or submit User Content, you grant MingleMate a <strong>non-exclusive,
          worldwide, royalty-free licence</strong> to host, store, reproduce, process, display and
          technically transmit that content as reasonably necessary to:
        </p>
        <ul>
          <li>operate MingleMate;</li>
          <li>provide the features you request;</li>
          <li>display your profile to other users according to your settings;</li>
          <li>provide matching and recommendation functionality;</li>
          <li>maintain and improve the Service;</li>
          <li>protect the security of the Platform; and</li>
          <li>comply with legal obligations.</li>
        </ul>
        <p>This licence does not transfer ownership of your User Content to MingleMate.</p>
        <p>
          When you delete User Content or your account, MingleMate will handle the relevant
          information in accordance with its Privacy Policy, applicable retention obligations and
          legitimate operational or legal requirements.
        </p>

        <h2>12. Content Moderation</h2>
        <p>MingleMate may review, restrict, remove or disable access to User Content where reasonably necessary to:</p>
        <ul>
          <li>enforce these Terms;</li>
          <li>protect users;</li>
          <li>investigate suspected abuse;</li>
          <li>prevent fraud;</li>
          <li>protect the Platform;</li>
          <li>comply with applicable law; or</li>
          <li>respond to valid legal requests.</li>
        </ul>
        <p>MingleMate does not promise that every prohibited piece of content will be identified or removed immediately.</p>
        <p>The existence of moderation does not make MingleMate responsible for monitoring every interaction between users.</p>

        <h2>13. Reporting and Blocking</h2>
        <p>MingleMate may provide tools that allow users to report or block other users.</p>
        <p>Reports should be made honestly and in good faith.</p>
        <p>You must not knowingly submit false or malicious reports intended to harm another user.</p>
        <p>MingleMate may investigate reports and take action it considers appropriate under these Terms and applicable law.</p>

        <h2>14. Privacy and Personal Data</h2>
        <p>Your use of MingleMate involves the processing of personal information.</p>
        <p>
          MingleMate's collection, use, storage, disclosure and other processing of personal data is
          governed by the <strong>MingleMate Privacy Policy</strong>, which forms part of the overall
          legal framework governing your use of the Platform.
        </p>
        <p>The Privacy Policy explains, among other things:</p>
        <ul>
          <li>what information MingleMate collects;</li>
          <li>why information is collected;</li>
          <li>how information is used;</li>
          <li>how information may be shared;</li>
          <li>how information is protected;</li>
          <li>retention practices;</li>
          <li>your data-protection rights;</li>
          <li>how to make a privacy request; and</li>
          <li>how to raise a privacy complaint.</li>
        </ul>
        <p>MingleMate will process personal data in accordance with applicable Kenyan data-protection law.</p>
        <p>
          The Kenyan data-protection framework includes principles concerning lawfulness, fairness
          and transparency, purpose limitation, data minimisation, accuracy, storage limitation,
          security and accountability.
        </p>
        <p>
          You should read the{' '}
          <Link to="/privacy">Privacy Policy</Link> before using MingleMate.
        </p>

        <h2>15. Sensitive Personal Information</h2>
        <p>Certain information that users may voluntarily provide on a relationship platform may constitute sensitive personal data under Kenyan law.</p>
        <p>Examples can include information relating to:</p>
        <ul>
          <li>sexual orientation;</li>
          <li>marital status;</li>
          <li>health;</li>
          <li>beliefs;</li>
          <li>ethnicity;</li>
          <li>family circumstances; and</li>
          <li>other categories recognized by applicable law.</li>
        </ul>
        <p>MingleMate will process such information only where there is an applicable lawful basis and appropriate safeguards.</p>
        <p>You should not provide sensitive information through MingleMate unless you understand how that information may be processed.</p>

        <h2>16. Your Data Protection Rights</h2>
        <p>Subject to applicable law, you may have rights concerning your personal data, including rights relating to:</p>
        <ul>
          <li>being informed about processing;</li>
          <li>access;</li>
          <li>correction;</li>
          <li>deletion or erasure;</li>
          <li>restriction;</li>
          <li>objection;</li>
          <li>data portability; and</li>
          <li>other rights provided by applicable data-protection legislation.</li>
        </ul>
        <p>The ODPC identifies these rights for data subjects under Kenya's data-protection framework.</p>
        <p>Requests concerning personal data should be made using the contact information provided in the MingleMate Privacy Policy.</p>

        <h2>17. Account Security</h2>
        <p>You are responsible for protecting your account credentials.</p>
        <p>You must not:</p>
        <ul>
          <li>share your password unnecessarily;</li>
          <li>allow unauthorized persons to use your account;</li>
          <li>attempt to access another user's account; or</li>
          <li>knowingly permit your account to be used for prohibited conduct.</li>
        </ul>
        <p>If you believe your account has been compromised, notify MingleMate as soon as reasonably possible.</p>

        <h2>18. Intellectual Property</h2>
        <p>Except for User Content submitted by users, MingleMate and its licensors retain all rights in:</p>
        <ul>
          <li>the MingleMate name;</li>
          <li>logos;</li>
          <li>branding;</li>
          <li>software;</li>
          <li>source code;</li>
          <li>interface designs;</li>
          <li>graphics;</li>
          <li>databases;</li>
          <li>text;</li>
          <li>platform architecture;</li>
          <li>algorithms;</li>
          <li>compatibility systems;</li>
          <li>trademarks; and</li>
          <li>other MingleMate intellectual property.</li>
        </ul>
        <p>You may use the Platform only for its intended purposes.</p>
        <p>You may not reproduce, modify, distribute, sell or commercially exploit MingleMate's intellectual property without authorization, except where applicable law expressly permits such use.</p>

        <h2>19. Availability of the Service</h2>
        <p>MingleMate may change, suspend, discontinue or modify features of the Platform.</p>
        <p>We do not guarantee that:</p>
        <ul>
          <li>the Platform will always be available;</li>
          <li>every feature will remain available;</li>
          <li>the Platform will always operate without errors;</li>
          <li>compatibility results will always be generated correctly; or</li>
          <li>the Platform will be free from interruptions.</li>
        </ul>
        <p>We may perform maintenance, security updates or technical changes when necessary.</p>

        <h2>20. Third-Party Services</h2>
        <p>MingleMate may rely on third-party services for functions such as:</p>
        <ul>
          <li>hosting;</li>
          <li>authentication;</li>
          <li>communications;</li>
          <li>analytics;</li>
          <li>storage;</li>
          <li>security;</li>
          <li>payments; or</li>
          <li>other technical infrastructure.</li>
        </ul>
        <p>Third-party services may have their own terms and privacy policies.</p>
        <p>MingleMate is not responsible for the independent operation of third-party services to the extent permitted by applicable law.</p>

        <h2>21. No Guarantee of User Conduct</h2>
        <p>MingleMate does not conduct a universal background check or guarantee the accuracy of every statement made by a user.</p>
        <p>Users may misrepresent:</p>
        <ul>
          <li>their identity;</li>
          <li>age;</li>
          <li>occupation;</li>
          <li>relationship status;</li>
          <li>intentions;</li>
          <li>photographs;</li>
          <li>personal circumstances; or</li>
          <li>other information.</li>
        </ul>
        <p>You are responsible for exercising reasonable judgment when interacting with other users.</p>

        <h2>22. Disclaimer Regarding Relationships</h2>
        <p>MingleMate does not guarantee any particular relationship outcome.</p>
        <p>Compatibility information is not a substitute for:</p>
        <ul>
          <li>personal judgment;</li>
          <li>communication;</li>
          <li>professional counselling;</li>
          <li>medical advice;</li>
          <li>psychological assessment; or</li>
          <li>legal advice.</li>
        </ul>
        <p>You should not rely solely on a compatibility result when making important personal decisions.</p>

        <h2>23. Limitation of Liability</h2>
        <p>To the maximum extent permitted by applicable law, MingleMate will not be liable for indirect, incidental, special, consequential or unforeseeable losses arising from your use of the Platform.</p>
        <p>This may include losses arising from:</p>
        <ul>
          <li>interactions with another user;</li>
          <li>communications between users;</li>
          <li>decisions made based on compatibility results;</li>
          <li>meetings arranged independently by users;</li>
          <li>inaccurate information provided by users;</li>
          <li>unauthorized conduct by another user; or</li>
          <li>temporary Platform interruption.</li>
        </ul>
        <p>Nothing in these Terms excludes or limits liability that cannot lawfully be excluded or limited under applicable Kenyan law.</p>
        <p>Nothing in these Terms is intended to remove rights or protections that cannot legally be waived.</p>

        <h2>24. Indemnity</h2>
        <p>To the extent permitted by applicable law, you agree to be responsible for losses, claims, liabilities and reasonable costs arising from your:</p>
        <ul>
          <li>violation of these Terms;</li>
          <li>unlawful use of the Platform;</li>
          <li>infringement of another person's rights;</li>
          <li>User Content; or</li>
          <li>misuse of the Service.</li>
        </ul>
        <p>This clause does not require you to indemnify MingleMate for losses caused by MingleMate's own unlawful conduct or liability that cannot legally be transferred to you.</p>

        <h2>25. Suspension and Termination</h2>
        <p>You may stop using MingleMate at any time.</p>
        <p>MingleMate may suspend or terminate your account where reasonably necessary because:</p>
        <ul>
          <li>you violate these Terms;</li>
          <li>you engage in unlawful or abusive conduct;</li>
          <li>your account presents a security risk;</li>
          <li>your account is being used fraudulently;</li>
          <li>you provide materially false information;</li>
          <li>suspension is required by law; or</li>
          <li>continued access creates a material risk to MingleMate or other users.</li>
        </ul>
        <p>Where appropriate and legally permissible, MingleMate may provide notice before taking action.</p>
        <p>Serious violations may result in immediate suspension or termination.</p>

        <h2>26. Effect of Termination</h2>
        <p>When your account is terminated or deleted:</p>
        <ul>
          <li>your access to the Platform may cease;</li>
          <li>your profile may no longer be visible;</li>
          <li>your ability to communicate through MingleMate may end; and</li>
          <li>information may be deleted, anonymised or retained where permitted or required by applicable law.</li>
        </ul>
        <p>Termination does not automatically extinguish provisions of these Terms that are intended to survive termination.</p>

        <h2>27. Appeals</h2>
        <p>Where MingleMate restricts or terminates your account, you may contact MingleMate using the designated support channel to request a review, where such a review process is available.</p>
        <p>Your request should explain why you believe the decision was incorrect and provide relevant information.</p>
        <p>MingleMate may maintain restrictions where necessary to protect users, preserve security, prevent abuse or comply with law.</p>

        <h2>28. Changes to These Terms</h2>
        <p>MingleMate may update these Terms when necessary because of:</p>
        <ul>
          <li>changes to the Service;</li>
          <li>changes in law;</li>
          <li>security requirements;</li>
          <li>operational changes; or</li>
          <li>other legitimate business reasons.</li>
        </ul>
        <p>Where changes materially affect your rights or obligations, MingleMate will provide appropriate notice where required by applicable law.</p>
        <p>Your continued use of MingleMate after the effective date of revised Terms constitutes acceptance of the revised Terms where such acceptance is legally effective.</p>
        <p>If you do not agree to revised Terms, you should stop using the Service.</p>

        <h2>29. Electronic Agreement</h2>
        <p>You agree that electronic acceptance of these Terms may constitute your acceptance of this Agreement.</p>
        <p>Depending on the method used by MingleMate, acceptance may occur when you:</p>
        <ul>
          <li>select an acceptance checkbox;</li>
          <li>select a button clearly indicating acceptance;</li>
          <li>create an account after being presented with these Terms; or</li>
          <li>otherwise take an action that clearly indicates acceptance where legally permissible.</li>
        </ul>
        <p>MingleMate should provide users with reasonable access to a copy of the applicable Terms.</p>

        <h2>30. Governing Law</h2>
        <p>
          These Terms are governed by the laws of the <strong>Republic of Kenya</strong>, except to
          the extent mandatory law applicable to a particular user requires otherwise.
        </p>

        <h2>31. Dispute Resolution</h2>
        <p>If you have a dispute with MingleMate, you should first contact us and provide reasonable details of the issue.</p>
        <p>The parties should attempt in good faith to resolve the dispute through direct communication.</p>
        <p>Where appropriate and legally permissible, the parties may agree to use an appropriate form of alternative dispute resolution before commencing court proceedings.</p>
        <p>Nothing in this clause prevents a person from exercising a statutory right or seeking urgent legal relief where such action is permitted or required by law.</p>
        <p>Where court proceedings are legally appropriate, the courts of Kenya shall have jurisdiction, subject to any mandatory jurisdictional rights that cannot lawfully be excluded.</p>

        <h2>32. Consumer Rights</h2>
        <p>Nothing in these Terms is intended to remove or restrict mandatory consumer protections available to you under Kenyan law.</p>
        <p>Where applicable, statutory consumer rights take precedence over inconsistent contractual provisions.</p>
        <p>Kenya's Consumer Protection Act contains specific provisions concerning internet and remote agreements, including disclosure and provision of copies of agreements.</p>

        <h2>33. Severability</h2>
        <p>If a court or competent authority determines that any provision of these Terms is invalid, unlawful or unenforceable, that provision will be interpreted or modified to the minimum extent necessary where legally possible.</p>
        <p>The remaining provisions will continue to apply.</p>

        <h2>34. No Waiver</h2>
        <p>If MingleMate does not immediately enforce a provision of these Terms, that does not mean MingleMate has permanently waived the right to enforce that provision.</p>

        <h2>35. Entire Agreement</h2>
        <p>These Terms, together with the MingleMate Privacy Policy and any other terms expressly incorporated into the Platform, constitute the agreement between you and MingleMate concerning your use of the Service.</p>
        <p>They replace previous agreements or understandings concerning the same subject matter, except where expressly stated otherwise.</p>

        <h2>36. Contact</h2>
        <p>
          Questions, complaints or legal notices concerning these Terms should be directed to the
          contacts below; privacy matters are handled as described in the{' '}
          <Link to="/privacy">Privacy Policy</Link>.
        </p>
        <div className="legal-contact">
          <p><strong>MingleMate</strong></p>
          <p><strong>Operator/Legal Entity:</strong> [INSERT LEGAL ENTITY NAME]</p>
          <p><strong>Registered Address:</strong> [INSERT ADDRESS]</p>
          <p><strong>Email:</strong> [INSERT LEGAL/CONTACT EMAIL]</p>
          <p><strong>Privacy Contact:</strong> [INSERT PRIVACY EMAIL]</p>
        </div>

        <h2>37. Your Acknowledgement</h2>
        <p>By creating an account or using MingleMate, you acknowledge that:</p>
        <ul>
          <li>you are at least 18 years old;</li>
          <li>you have read these Terms;</li>
          <li>you understand that MingleMate is a relationship-discovery platform and not a guarantee of relationship success;</li>
          <li>you are responsible for the information you provide;</li>
          <li>you are responsible for your interactions with other users;</li>
          <li>you will use MingleMate lawfully and respectfully;</li>
          <li>you understand that compatibility results are not guarantees;</li>
          <li>you have reviewed or had the opportunity to review the Privacy Policy; and</li>
          <li>you agree to be bound by these Terms.</li>
        </ul>
        <p><strong>If you do not agree, do not use MingleMate.</strong></p>

        <div className="info-cta-row">
          <button className="btn-primary" onClick={() => navigate('/signup')}>
            Create your account
          </button>
          <Link to="/faq" className="btn-ghost" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center' }}>
            Read the FAQ
          </Link>
        </div>
      </main>

      <footer className="info-footer">
        <span>© {new Date().getFullYear()} MingleMate</span>
        <span>Matched by compatibility, not coincidence.</span>
      </footer>
    </div>
  )
}
