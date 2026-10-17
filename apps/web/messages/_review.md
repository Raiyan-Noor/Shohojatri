# Bangla strings to review

Strings a native speaker should check for natural, simple spoken register (CLAUDE.md §6). Remove an entry once reviewed.

- // TODO(bn-review) `errors.conflict` — "এটি অন্য কোনো পরিবর্তনের সাথে মিলছে না। পাতাটি আবার খুলে দেখুন।"
- // TODO(bn-review) `errors.validation_error` — "দাগ দেওয়া ঘরগুলো" for "the marked fields"
- // TODO(bn-review) `errors.method_not_allowed` — "এই কাজটি এখানে করা যায় না।"
- // TODO(bn-review) `auth.signup.contactVia` — "যা দিয়ে লগ ইন করবেন" (label of the phone/email tabs)
- // TODO(bn-review) `auth.setPassword.ruleMet` / `ruleNotMet` — "(হয়েছে)" / "(এখনো হয়নি)" (screen-reader only)
- // TODO(bn-review) `auth.login.forgotHelp` — no self-serve reset in the POC; wording of "contact the team"
- // TODO(bn-review) `homes.specialist.next` — "আপনার দেখা শিশুদের" for "the children you see" (avoids "রোগী")
- // TODO(bn-review) `admin.create.specialtyPlaceholder` — "শিশু স্নায়ুবিকাশ" for "child neurodevelopment"
- // TODO(bn-review) `admin.create.registrationHint` — "সংশ্লিষ্ট পেশাজীবী সংস্থা" for "relevant professional body"
- // TODO(bn-review) `errors.account_inactive` — "অ্যাকাউন্টটি এখন বন্ধ আছে" for "deactivated"
- // TODO(bn-review) `children.status.companion` — "সহযাত্রী প্রোফাইল" for the post-diagnosis profile
- // TODO(bn-review) `children.scope.education` / `clinical` — "শিক্ষা" / "চিকিৎসা" as access-scope chips
- // TODO(bn-review) `access.requestTitle` — "শিশুর প্রোফাইল দেখার অনুরোধ" for "Request access to a child"
- // TODO(bn-review) `activity.update` — word order "{actor} বদলেছেন {subject} কী দেখতে পাবেন"
- // TODO(bn-review) `activity.approve` — "{subject}-এর অনুরোধে অনুমোদন দিয়েছেন"; the `-এর` suffix after Latin names (e.g. "Rafi-এর") throughout
- // TODO(bn-review) `activity.resources.diagnosis` — "ডায়াগনোসিসের তথ্য" (loanword chosen over "রোগনির্ণয়")
- // TODO(bn-review) `notifications.markAll` — "সব পড়া হয়েছে" as a button label

### B4 — screening questionnaire

- // TODO(bn-review) **All 20 questionnaire items** (`apps/api/app/seed/questionnaire.yaml`, `text_bn`): SCREENING_SPEC §3.2 requires review by a native-speaking clinician before any pilot. The items avoid the child's name and use "শিশু"; check that this reads naturally.
- // TODO(bn-review) `screening.options.communication.*` and `screening.optionHints.communication.*` — q13 answer cards ("কয়েকটা শব্দ জুড়ে বলে", "আওয়াজ বা ইশারায় বোঝায়" …), written for this phase, not in the spec
- // TODO(bn-review) `screening.options.hearing.*` — "হ্যাঁ, সব ঠিক পাওয়া গেছে" / "হ্যাঁ, সমস্যা পাওয়া গেছে" / "না, করা হয়নি"
- // TODO(bn-review) `screening.domains.*` — short domain labels in the question header, e.g. "একসাথে দেখা" (joint attention), "আপনার মুখ দেখে বোঝা" (social referencing), "আগের শব্দ ও দক্ষতা" (regression, chosen to avoid an alarming word)
- // TODO(bn-review) `screening.consent.points.onDevice.body` — "মাপজোখ" for "measurements"
- // TODO(bn-review) `screening.details.informants.other_caregiver` — "অন্য কেউ যিনি দেখাশোনা করেন" (long for a chip; the design used "অন্য কেউ")
- // TODO(bn-review) `screening.question.aiTitle` — "সহযাত্রী বুঝে নিয়েছে" (from the design) over a literal "AI read your answer"
- // TODO(bn-review) `screening.later` — "পরে করব" for "Continue later"

### B7 — results, reports, sharing, demo mode

- // TODO(bn-review) `results.classes.*` — badge labels "কম / মাঝারি / বাড়তি / উচ্চ" without "ঝুঁকি" (the design's "কম ঝুঁকি" … reads as a chance of autism, CLAUDE.md §2 rule 2); check they're clear next to the gauge
- // TODO(bn-review) `results.gaugeLabel` — "প্রাথমিক লক্ষণের স্কোর" for "early-signs score"; `report.clinician.score` — "বিকাশ-সংক্রান্ত উদ্বেগের স্কোর" for the doctor's "developmental concern score"
- // TODO(bn-review) `results.scoreNote` — "… অটিজম হওয়ার সম্ভাবনা নয়" (needs a clinician's eye: it names autism to say what the score is not)
- // TODO(bn-review) `results.meaning.*` and `results.support` — adapted from the design's Results R1–R4 copy; `meaning.moderate|elevated|high` use "{name}-এর" after Latin names
- // TODO(bn-review) `findings.items.*` — 19 short paraphrases of the questionnaire items (concern and strength forms), e.g. "নাম ধরে ডাকলে {মাঝে মাঝে / খুব কম} সাড়া দেয়"; C items use "প্রায়ই / মাঝে মাঝে"
- // TODO(bn-review) `findings.free_play.repetitive_movement` — "শরীরের ওপরের অংশের একই নড়াচড়া" for "repeated upper-body movement" (must not sound like a diagnostic label)
- // TODO(bn-review) `findings.joint_attention.followed` — "আঙুল দিয়ে দেখানো খেলনার দিকে … তাকিয়েছে" covers both the on-screen character and the parent pointing
- // TODO(bn-review) `recommendations.*` — §6.2/§6.3 recommendations in Bangla (not in the spec), e.g. "বিকাশ মূল্যায়ন" for "developmental assessment"
- // TODO(bn-review) `results.confidence.levels.*` — "ভালো / মাঝারি / কম" for Good / Fair / Limited
- // TODO(bn-review) `report.clinician.*` — the whole Bangla doctor report (table headers, metrics lines, method and limits), e.g. "গ্রহণযোগ্য চেষ্টা" for "valid trials", "ক্যালিব্রেশন", "ন্যূনতম শ্রেণি" for "floors"; a clinician should read it
- // TODO(bn-review) `share.*` — share sheet copy (from design S1–S3 where it exists): "নিজে থেকেই বন্ধ হবে", "লিংকটি এখনই বন্ধ করুন", the "shown only once" note
- // TODO(bn-review) `demo.profiles.*` and `settings.demo.*` — "ডেমো মোড", "রেকর্ড করা নমুনা" for "recorded sample session"

### B6 — camera games

- // TODO(bn-review) `activities.nameCall.callNow` — "এখন একবার নাম ধরে ডাকুন" (from the design) and `watchingHow` "আর ডাকবেন না, চুপচাপ থাকুন"
- // TODO(bn-review) `activities.point.*` — the live-pointing steps: "খেলনাটা যেন ছবির বাঁ দিকে দেখা যায়, তারপর বাঁ দিকে চাপুন" (long for the camera overlay; check it reads at a glance)
- // TODO(bn-review) `activities.copy.moves.*` — "হাত উপরে", "হাততালি", "হাত নাড়া", "মাথা ছোঁয়া"; the voice lines "এভাবে করো!" / "এত্ত বড়!" come from the spec
- // TODO(bn-review) `activities.outcome.*` — "কম পরিষ্কার" for a `low` task and "মাপা যায়নি" for an inconclusive one; check they don't sound like a judgement of the child
- // TODO(bn-review) `activities.camera.promise.*` and `screening.activities.privacy` — the "picture and sound never leave this device" promise (the design's "ভিডিও শুধু আপনার অনুমতিতে সংরক্ষিত হয়" was replaced, because nothing is ever saved)
- // TODO(bn-review) `activities.setup.device.*` — "ফোন (হাতে ধরব)" / "ল্যাপটপ বা ট্যাবলেট (টেবিলে রাখব)"
- // TODO(bn-review) `{name}-কে` / `{name}-এর` after Latin names throughout `activities.*`

### Deploy — demo banner, offline page, install prompt

- // TODO(bn-review) `demoBanner.dismiss` — "বার্তাটি বন্ধ করুন" (screen-reader label of the ✕)
- // TODO(bn-review) `pwa.install.title` — "ফোনে অ্যাপ হিসেবে রাখুন" for "Add Shohojatri to your phone"
- // TODO(bn-review) `pwa.install.iosSteps` — keeps Safari's menu item “Add to Home Screen” in English (iOS has no Bangla UI); check the description of the Share icon
- // TODO(bn-review) `meta.pages.offline` / `offline.title` — "ইন্টারনেট নেই" / "ইন্টারনেট সংযোগ নেই"

### B8 — results chat

- // TODO(bn-review) `resultsChat.banner` — "আমি রিপোর্টটা বুঝতে সাহায্য করি — এটি রোগনির্ণয় নয়।" (from the design's C1 frame, lightly edited)
- // TODO(bn-review) `resultsChat.intro` — "আমি শুধু এই স্ক্রিনিংয়ের তথ্য দেখে উত্তর দিই"
- // TODO(bn-review) `errors.ai_unavailable` — "আপনার প্রশ্নটা বক্সেই আছে" for "your question is still in the box"
- // TODO(bn-review) The model's Bangla replies: `results_explainer.md` asks for simple spoken Bangla and "আপনার সন্তান/বাচ্চা"; check real replies with a native speaker before a pilot.

### B9 — companion profile, characteristics, timeline

- // TODO(bn-review) `companion.diagnosis.kinds.*` — "অটিজম, সাথে অন্য একটি অবস্থা", "অন্য কোনো বিকাশজনিত অবস্থা" for "another developmental condition"
- // TODO(bn-review) the characteristics questionnaire (`apps/api/app/seed/characteristics.yaml`, every `text_bn` and `bn`) — e.g. "নিজের কথা বোঝায়", "বড়দের হাত ধরে টেনে নিয়ে যায়", "এড়িয়ে চলে / খোঁজে / পার্থক্য নেই" for the sensory grid; a clinician should read it
- // TODO(bn-review) `logs.domains.*` — "ভাষা ও যোগাযোগ", "আচরণ ও আবেগ", "দৈনন্দিন কাজ" for daily living, "চলাফেরা" for motor
- // TODO(bn-review) `logs.types.*` — "যা দেখলাম" for observation, "দুশ্চিন্তা" for concern, "ক্লিনিক্যাল নোট" (kept as a loanword)
- // TODO(bn-review) `logs.moods.*` and `logs.faces.*` — "মন খারাপ / অস্থির / শান্ত / খুশি / খুব খুশি"
- // TODO(bn-review) `logs.templates.*` — the teacher and specialist template headings ("যা কাজে দিয়েছে", "বাসার জন্য পরামর্শ")
- // TODO(bn-review) `logs.visibility.*` — "শুধু বিশেষজ্ঞ" for clinical, "ব্যক্তিগত" for private
- // TODO(bn-review) `logs.explain.*` — "সহজ করে বুঝিয়ে দিন" (from the design), "আমার নোট হিসেবে রাখুন"; and the model's Bangla explanations (`log_explainer.md`) need a native speaker's check with a real key
- // TODO(bn-review) `notifications.kinds.log_added` / `log_digest` — "{child}-এর বিষয়ে" after Latin names

### Companion chat (first version)

- // TODO(bn-review) `companionChat.empty.*` — "{name}-এর বিষয়ে যা খুশি জিজ্ঞেস করুন", "আমি শুধু {name}-এর লগ আর নোট দেখে উত্তর দিই। আমি ডাক্তার নই, রোগনির্ণয়ও করি না।"
- // TODO(bn-review) `companionChat.source.*` — "শিক্ষকের নোট" (gender-neutral; the design has "শিক্ষিকার"), "অভিভাবকের লগ", "বিশেষজ্ঞের নোট"
- // TODO(bn-review) `companionChat.urgent.*` — the urgent card ("এখনই একজন ডাক্তারের সাথে কথা বলুন", "এটা চ্যাটে সামলানোর বিষয় নয়"); a clinician should read it with OPEN_QUESTIONS #20
- // TODO(bn-review) `companionChat.suggestions.*` — e.g. "“{goal}” — এই লক্ষ্যে {name} কেমন এগোচ্ছে?", "{name} অস্থির হলে কী করলে শান্ত হয়?"
- // TODO(bn-review) `companionChat.errors.*` — "আজকের প্রশ্নের সীমা শেষ", "সমস্যাটা আমাদের দিকে"
- // TODO(bn-review) the model's Bangla replies (`companion_system.md`) need a native speaker's check with a real key (`scripts/try_chat.py`)
