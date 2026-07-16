import type { PracticeSet, VocabularyWord } from "@/lib/domain";

export const seedVocabulary: VocabularyWord[] = [
  {
    id: "ambiguity",
    term: "ambiguity",
    pronunciation: "/ˌæm.bɪˈɡjuː.ə.ti/",
    partOfSpeech: "noun",
    meaningZh: "模棱两可；歧义",
    definitionEn:
      "A situation in which something has more than one possible meaning.",
    example: "The policy's ambiguity caused widespread confusion.",
    tags: ["academic", "writing"],
    repetitions: 0,
    intervalDays: 0,
    easeFactor: 2.5,
    dueAt: new Date(0).toISOString(),
  },
  {
    id: "mitigate",
    term: "mitigate",
    pronunciation: "/ˈmɪt.ɪ.ɡeɪt/",
    partOfSpeech: "verb",
    meaningZh: "减轻；缓和",
    definitionEn: "To make a harmful situation less serious or painful.",
    example: "Urban trees can mitigate the effects of extreme heat.",
    tags: ["academic", "environment"],
    repetitions: 0,
    intervalDays: 0,
    easeFactor: 2.5,
    dueAt: new Date(0).toISOString(),
  },
  {
    id: "prevalent",
    term: "prevalent",
    pronunciation: "/ˈprev.əl.ənt/",
    partOfSpeech: "adjective",
    meaningZh: "普遍的；盛行的",
    definitionEn: "Existing very commonly in a particular place or time.",
    example: "Remote work has become increasingly prevalent.",
    tags: ["academic", "society"],
    repetitions: 0,
    intervalDays: 0,
    easeFactor: 2.5,
    dueAt: new Date(0).toISOString(),
  },
  {
    id: "allocate",
    term: "allocate",
    pronunciation: "/ˈæl.ə.keɪt/",
    partOfSpeech: "verb",
    meaningZh: "分配；拨给",
    definitionEn: "To give a share of money, time, or resources for a purpose.",
    example: "The council allocated more funds to public transport.",
    tags: ["academic", "government"],
    repetitions: 0,
    intervalDays: 0,
    easeFactor: 2.5,
    dueAt: new Date(0).toISOString(),
  },
  {
    id: "coherent",
    term: "coherent",
    pronunciation: "/kəʊˈhɪə.rənt/",
    partOfSpeech: "adjective",
    meaningZh: "连贯的；条理清楚的",
    definitionEn: "Logical and well organised, so that it is easy to understand.",
    example: "A coherent argument needs clear links between its main ideas.",
    tags: ["writing", "academic"],
    repetitions: 0,
    intervalDays: 0,
    easeFactor: 2.5,
    dueAt: new Date(0).toISOString(),
  },
  {
    id: "substantial",
    term: "substantial",
    pronunciation: "/səbˈstæn.ʃəl/",
    partOfSpeech: "adjective",
    meaningZh: "大量的；重大的",
    definitionEn: "Large in size, value, or importance.",
    example: "The project required a substantial investment of public money.",
    tags: ["academic", "economy"],
    repetitions: 0,
    intervalDays: 0,
    easeFactor: 2.5,
    dueAt: new Date(0).toISOString(),
  },
  {
    id: "conventional",
    term: "conventional",
    pronunciation: "/kənˈven.ʃən.əl/",
    partOfSpeech: "adjective",
    meaningZh: "传统的；常规的",
    definitionEn: "Following what is traditional or commonly accepted.",
    example: "The new design uses less energy than a conventional building.",
    tags: ["academic", "technology"],
    repetitions: 0,
    intervalDays: 0,
    easeFactor: 2.5,
    dueAt: new Date(0).toISOString(),
  },
  {
    id: "deteriorate",
    term: "deteriorate",
    pronunciation: "/dɪˈtɪə.ri.ə.reɪt/",
    partOfSpeech: "verb",
    meaningZh: "恶化；退化",
    definitionEn: "To become worse in quality or condition.",
    example: "Air quality may deteriorate during periods of heavy traffic.",
    tags: ["academic", "environment"],
    repetitions: 0,
    intervalDays: 0,
    easeFactor: 2.5,
    dueAt: new Date(0).toISOString(),
  },
];

export const seedPracticeSets: PracticeSet[] = [
  {
    id: "reading-urban-cooling",
    kind: "reading",
    title: "Cooling the Compact City",
    subtitle: "Academic Reading · Passage 1",
    instructions:
      "Read the passage and answer all questions. Suggested time: 18 minutes.",
    durationMinutes: 18,
    audioUrl: "",
    transcript: "",
    passage: `As cities become denser, their centres often remain warmer than nearby rural areas after sunset. This urban heat island effect is partly caused by dark surfaces that absorb solar energy during the day and release it slowly at night. Waste heat from vehicles and buildings adds to the problem.

City planners once treated heat mainly as an engineering challenge. Their preferred responses were mechanical cooling and reflective construction materials. More recently, however, researchers have examined how networks of small green spaces can influence neighbourhood temperatures. A single pocket park may have only a modest effect, but several connected sites can create corridors through which cooler air moves.

Trees are especially useful because they provide shade and release water vapour. Yet planting programmes do not succeed automatically. Young trees need water, suitable soil and long-term maintenance. Species must also be selected for the future climate rather than the historic one. A tree that thrives today may struggle after two decades of hotter summers.

Some municipalities now combine satellite temperature maps with public-health data. This allows them to identify districts where extreme heat overlaps with older populations, poor housing and limited access to parks. Support can then be allocated more precisely. Critics warn that new greenery may raise local property values and displace the residents it was intended to help, so cooling policies increasingly include affordable-housing protections.

The emerging lesson is that no single intervention is sufficient. Reflective roofs, efficient transport, shade, ventilation and social policy work best as a coordinated system. The coolest city is not necessarily the one with the most trees, but the one that places the right measures where vulnerable people need them most.`,
    questions: [
      {
        id: "r1",
        kind: "short-answer",
        prompt:
          "What kind of surfaces absorb solar energy and release it at night?",
        answers: ["dark surfaces"],
        explanation:
          "The first paragraph directly identifies dark surfaces as a cause.",
      },
      {
        id: "r2",
        kind: "true-false-not-given",
        prompt:
          "A single pocket park always causes a major reduction in neighbourhood temperature.",
        options: ["TRUE", "FALSE", "NOT GIVEN"],
        answers: ["false"],
        explanation:
          "The passage says a single pocket park may have only a modest effect.",
      },
      {
        id: "r3",
        kind: "multiple-choice",
        prompt: "Why should tree species be chosen for future conditions?",
        options: [
          "They are cheaper to maintain.",
          "Historic climates were wetter.",
          "Today’s suitable trees may not tolerate hotter summers.",
          "Satellite maps require particular species.",
        ],
        answers: [
          "Today’s suitable trees may not tolerate hotter summers.",
        ],
        explanation:
          "The passage warns that a tree thriving now may struggle in a hotter future.",
      },
      {
        id: "r4",
        kind: "short-answer",
        prompt:
          "Which two types of data are combined to locate vulnerable districts?",
        answers: [
          "satellite temperature maps and public-health data",
          "satellite temperature maps and public health data",
        ],
        explanation:
          "These two datasets are named at the start of paragraph four.",
      },
      {
        id: "r5",
        kind: "true-false-not-given",
        prompt:
          "All critics oppose the creation of new urban green spaces.",
        options: ["TRUE", "FALSE", "NOT GIVEN"],
        answers: ["not given"],
        explanation:
          "Critics warn about displacement, but their overall position is not stated.",
      },
      {
        id: "r6",
        kind: "multiple-choice",
        prompt: "What is the writer’s main conclusion?",
        options: [
          "Mechanical cooling should be abandoned.",
          "Cities need a coordinated mix of targeted measures.",
          "Every district should receive the same number of trees.",
          "Property values are the best measure of cooling success.",
        ],
        answers: ["Cities need a coordinated mix of targeted measures."],
        explanation:
          "The final paragraph argues that a coordinated, targeted system works best.",
      },
      {
        id: "r7",
        kind: "short-answer",
        prompt:
          "What housing measure may accompany urban cooling policies?",
        answers: ["affordable-housing protections", "affordable housing protections"],
        explanation:
          "Affordable-housing protections are mentioned as a response to displacement.",
      },
      {
        id: "r8",
        kind: "true-false-not-given",
        prompt:
          "The city with the greatest number of trees is necessarily the coolest.",
        options: ["TRUE", "FALSE", "NOT GIVEN"],
        answers: ["false"],
        explanation:
          "The final sentence explicitly rejects this idea.",
      },
    ],
  },
  {
    id: "listening-campus-project",
    kind: "listening",
    title: "Campus Sustainability Project",
    subtitle: "Academic Listening · Section 3",
    instructions:
      "Play the recording once and answer the questions. You may use browser speech or upload your own audio later.",
    durationMinutes: 12,
    audioUrl: "",
    passage: "",
    transcript: `Tutor: So, Maya and Daniel, tell me how your project on food waste is developing.

Maya: We originally planned to study every café on campus, but there are twelve of them. We decided that was too broad, so we selected the four busiest cafés instead.

Daniel: Our first idea was to interview customers. Then the café managers showed us their disposal records, which were much more reliable. We are using those records as our main source of data.

Tutor: Good. Have you found a clear pattern?

Maya: Yes. The largest amount of waste is produced on Fridays. We expected Monday to be worst because cafés prepare extra food after the weekend, but Friday is consistently higher.

Daniel: Sandwiches account for the greatest volume. Fruit looks significant because so many pieces are thrown away, but it weighs much less.

Tutor: What solution will you recommend?

Maya: We considered smaller portions, but the survey suggests students would dislike that. Instead, we want the cafés to offer a discount during the final hour before closing.

Daniel: We will test the idea in the library café because it stays open latest. The trial should last six weeks, although the managers first suggested four.

Tutor: How will you communicate the results?

Maya: Daniel will design the charts, and I will write the summary. We both want to present, so we will divide the ten-minute talk equally.

Tutor: Remember to include limitations. Disposal records show the amount of waste, but they do not explain why customers leave food.

Daniel: Right. We will make that clear in the final report.`,
    questions: [
      {
        id: "l1",
        kind: "short-answer",
        prompt: "How many cafés will the students study?",
        answers: ["four", "4"],
        explanation: "They select the four busiest cafés.",
      },
      {
        id: "l2",
        kind: "multiple-choice",
        prompt: "What is their main source of data?",
        options: [
          "Customer interviews",
          "Disposal records",
          "Staff surveys",
          "Direct observation",
        ],
        answers: ["Disposal records"],
        explanation: "Daniel says the disposal records are their main source.",
      },
      {
        id: "l3",
        kind: "short-answer",
        prompt: "On which day is the most waste produced?",
        answers: ["Friday", "Fridays"],
        explanation: "Maya says Friday is consistently higher.",
      },
      {
        id: "l4",
        kind: "short-answer",
        prompt: "Which food creates the greatest volume of waste?",
        answers: ["sandwiches", "sandwich"],
        explanation: "Daniel identifies sandwiches.",
      },
      {
        id: "l5",
        kind: "multiple-choice",
        prompt: "What solution will they recommend?",
        options: [
          "Smaller portions",
          "Fewer menu items",
          "A closing-time discount",
          "Free fruit",
        ],
        answers: ["A closing-time discount"],
        explanation: "They want a discount in the final hour.",
      },
      {
        id: "l6",
        kind: "short-answer",
        prompt: "Where will the trial take place?",
        answers: ["library café", "library cafe", "the library café", "the library cafe"],
        explanation: "They choose the library café.",
      },
      {
        id: "l7",
        kind: "short-answer",
        prompt: "How long should the trial last?",
        answers: ["six weeks", "6 weeks"],
        explanation: "The planned trial lasts six weeks.",
      },
      {
        id: "l8",
        kind: "true-false-not-given",
        prompt:
          "Disposal records reveal the reasons customers leave food.",
        options: ["TRUE", "FALSE", "NOT GIVEN"],
        answers: ["false"],
        explanation:
          "The tutor says records show the amount but not the reasons.",
      },
    ],
  },
];

