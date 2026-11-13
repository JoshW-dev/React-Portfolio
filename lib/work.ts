export type WorkKind =
  | "Work"
  | "Product"
  | "Research"
  | "Game"
  | "Art"
  | "Tool"
  | "Engineering";

export type Work = {
  slug: string;
  title: string;
  /** One sentence, 14 words or fewer. */
  summary: string;
  kind: WorkKind;
  industry?: string;
  years?: string;
  /** "/work/<file>.webp", sizes vary, so each entry carries its own. */
  image?: { src: string; alt: string; width: number; height: number };
  /**
   * The home page film's frame for this project. When set, the project page opens on it,
   * full-bleed, with the title over it where the film's caption sits.
   */
  frame?: { src: string; alt: string };
  body: string[];
  stack?: string[];
  links: { label: string; href: string }[];
};

const entries: Work[] = [
  {
    slug: "alltus",
    title: "Alltus",
    summary: "AI for county governments: voice and chat agents that take routine work off staff.",
    kind: "Work",
    industry: "Government",
    years: "2026 to now",
    stack: ["Twilio", "ElevenLabs", "Langfuse", "RAG", "Python", "TypeScript"],
    frame: {
      src: "/film/07-towns.webp",
      alt: "Illustration of farm country at night from high above, a river and the lights of small towns under a full moon",
    },
    links: [{ label: "Open alltus.com", href: "https://www.alltus.com/" }],
    body: [
      "Alltus makes AI software for local government, and until 2026 it was called Just Appraised.",
      "The call routing and the voice agents run on Twilio and ElevenLabs, and prompts are managed in Langfuse.",
      "For government teams in Texas and California, being the engineer on the launch has also meant building the knowledge base and handling customer communication until go-live.",
      "The work reaches past the phone line. A lot of it is setting up the systems that automate county paperwork, and one recent deployment helped run elections in North Carolina.",
    ],
  },
  {
    slug: "disco",
    title: "Disco",
    summary: "An AI course builder that helped close enterprise deals, and the automation behind sales.",
    kind: "Work",
    industry: "Education",
    years: "2023 to 2026",
    image: {
      src: "/work/disco.webp",
      width: 1000,
      height: 436,
      alt: "Disco's home page with the headline Human-First, AI-Native Learning",
    },
    stack: ["Claude", "RAG", "MCP", "Make.com", "TypeScript", "Python"],
    frame: {
      src: "/film/05-twin.webp",
      alt: "Illustration of a carton packaging line drawn as a glowing wireframe model, robot arms over the conveyor",
    },
    links: [{ label: "Open disco.co", href: "https://www.disco.co/" }],
    body: [
      "I worked on the product and on the systems the sales and marketing teams ran on.",
      "One piece the steps above leave out is a content system I built for SEO and AI search. It got Disco cited in ChatGPT and Google AI Overviews while doubling site activity.",
    ],
  },
  {
    slug: "hydrogen-plant",
    title: "Clean hydrogen plant",
    summary: "Design sessions that cut more than $300M from a hydrogen plant's capital budget.",
    kind: "Work",
    industry: "Energy",
    years: "2021 to 2023",
    image: {
      src: "/film/03-plant.webp",
      width: 1344,
      height: 752,
      alt: "Illustration of a hydrogen plant at sunrise, seen along a pipe rack with mountains behind",
    },
    frame: {
      src: "/film/03-plant.webp",
      alt: "Illustration of a hydrogen plant at sunrise, seen along a pipe rack with mountains behind",
    },
    links: [],
    body: [
      "I worked on this as an engineering consultant in Alberta, leading the design working sessions on a blue hydrogen production project.",
    ],
  },
  {
    slug: "fastform",
    title: "Fastform",
    summary: "Turns any PDF into plain-English questions, then writes your answers onto the form.",
    kind: "Product",
    image: {
      src: "/work/fastform.webp",
      width: 1000,
      height: 625,
      alt: "Fastform with an IRS W-9 on the left and its plain-English questions on the right",
    },
    stack: ["Claude", "Stripe", "Playwright"],
    links: [{ label: "Open the live site", href: "https://fastform.site/" }],
    body: [
      "A form filler for government and immigration paperwork. Drop in any PDF and every box turns into a plain-English question, grouped the way the form is laid out, with a short briefing on what to have ready and the mistakes people make on it. Answers go onto the real form as you type or talk, and a saved profile fills in the details you repeat.",
      "Claude reads each page as an image with a numbered box over every field to write the questions, and on a scanned form with no fields it finds the blanks itself and returns their coordinates.",
      "It's built as a paid product, with a two-field signup that holds on to the file you dropped, Stripe subscriptions and the paywall at the download, a monthly AI spend ceiling on each plan, and saved client profiles on Pro. Playwright tests pay with Stripe's test card and open the downloaded PDF to check the answer is in it.",
    ],
  },
  {
    slug: "openaffect",
    title: "OpenAffect",
    summary: "Second-by-second predictions of how an audience reacts to a script or clip.",
    kind: "Product",
    industry: "Media",
    image: {
      src: "/work/openaffect.webp",
      width: 1000,
      height: 568,
      alt: "OpenAffect's home page beside a 3D brain lit up in orange",
    },
    links: [{ label: "Open the live site", href: "https://www.openaffect.ai/" }],
    body: [
      "Predictive AI for virality. Drop in any script, hook, or clip and see exactly how audiences will react, where you lose them, and what to change to make it go viral.",
      "Maps every second of content to neural activation to reveal the emotion viewers feel and the action they'll take next.",
    ],
  },
  {
    slug: "highstyle",
    title: "Highstyle",
    summary: "Cuts long podcasts and webinars into ranked, captioned short clips.",
    kind: "Product",
    industry: "Media",
    image: {
      src: "/work/highstyle.webp",
      width: 1000,
      height: 625,
      alt: "Highstyle's upload box above a row of vertical clips cut from one podcast",
    },
    links: [{ label: "Open the live site", href: "https://highstyle.ai/" }],
    body: [
      "AI video clipper for content operators. Drop in a long-form podcast, webinar, or interview and Highstyle returns ranked, captioned, on-brand short clips, automatically reframed for 9:16, 1:1, and 16:9 and ready to post to TikTok, Reels, Shorts, and LinkedIn.",
      "Built for teams running clipping at real spend, it surfaces the moments that drive watch time and saves, which often aren't the loudest ones.",
    ],
  },
  {
    slug: "crimsonlead",
    title: "Crimsonlead",
    summary: "Reads public records each morning and turns the new ones into graded leads.",
    frame: { src: "/film/07-towns.webp", alt: "Small-town lights across the United States at night, seen from the air" },
    kind: "Product",
    industry: "Sales",
    image: {
      src: "/work/crimsonlead.webp",
      width: 1200,
      height: 630,
      alt: "Crimsonlead's front page: a headline beside a map of North America, with red lines joining records to buyers",
    },
    stack: ["Next.js", "TypeScript", "Postgres"],
    links: [{ label: "Open crimsonlead.com", href: "https://crimsonlead.com/" }],
    body: [
      "Government offices publish records every day that show a business is about to need something. A new trucking authority needs insurance, a federal bid for HVAC work needs a contractor, and a company that files a fundraising notice will soon need payroll.",
      "It runs daily behind a password, and so far I haven't sent a single message from it. I'm still finding out which desks produce leads that are worth a person's time.",
    ],
  },
  {
    slug: "insider-signal",
    title: "Insider Signal",
    summary: "A watchlist of insider stock purchases, built from SEC filings.",
    frame: { src: "/film/08-nyc.webp", alt: "A Manhattan avenue at night, seen from above" },
    kind: "Product",
    industry: "Finance",
    image: {
      src: "/work/insider-trader.webp",
      width: 1000,
      height: 571,
      alt: "Dashboard with three featured insider trades charted above a table of the latest purchases",
    },
    links: [
      { label: "Open the live site", href: "https://www.insidersignal.ai/" },
      { label: "View the code", href: "https://github.com/JoshW-dev/insider-alert" },
    ],
    body: [
      "Web app that tracks stock purchases by high-level company insiders by webscraping and compiling SEC data. I use this on a regular basis to inform my trading.",
    ],
  },
  {
    slug: "sketch-deck",
    title: "Sketch Deck",
    summary: "Hand-drawn diagrams that build up beside me on camera while I talk.",
    kind: "Tool",
    image: {
      src: "/work/sketch-deck.webp",
      width: 1000,
      height: 625,
      alt: "A hand-drawn slide with a lemonade stand and the sums for a $100 mixer",
    },
    stack: ["HTML", "rough.js", "Headless Chrome"],
    links: [
      {
        label: "Open the live site",
        href: "https://joshw-dev.github.io/sketch-deck/videos/ai-bottleneck/?demo",
      },
      { label: "View the code", href: "https://github.com/JoshW-dev/sketch-deck" },
    ],
    body: [
      "A system I use to make explainer videos where hand-drawn diagrams build up beside me as I talk. Each video is one HTML page with an overview board of the talk, and each part of it builds in about five steps as I press a key, with text typing itself out while boxes, arrows and bars draw themselves in.",
      "I present it live in full-screen Chrome and record screen and camera together, so every drawing appears on the sentence it belongs to and there's nothing to sync in the edit. The strokes come from rough.js with fixed seeds, which means a diagram looks the same every time it's drawn, and the fonts are Excalidraw's.",
      "A presenter window shows my notes for each step on a second screen. New videos start from a template with one command, and a second command renders screenshots and GIFs in headless Chrome.",
      "The first deck is a five-minute talk on why AI belongs on a business's bottleneck, told through a lemonade stand and a juice box line from my years as an operations consultant in manufacturing plants. I worked out the format by taking apart one of Nick Saraev's Claude Code videos frame by frame.",
    ],
  },
  {
    slug: "bottleneck-radar",
    title: "Bottleneck Radar",
    summary: "Each month it finds the physical input in shortest supply for the AI buildout.",
    frame: { src: "/film/08-nyc.webp", alt: "A Manhattan avenue at night, seen from above" },
    kind: "Research",
    image: {
      src: "/work/bottleneck-radar.webp",
      width: 1000,
      height: 625,
      alt: "Bottleneck Radar's dashboard with monthly capex and supply figures beside a dotted globe",
    },
    stack: ["Claude Sonnet", "GitHub Actions", "WebGL", "IBKR Flex"],
    links: [
      { label: "Open the live site", href: "https://bottleneck-radar-two.vercel.app/" },
      { label: "View the code", href: "https://github.com/JoshW-dev/bottleneck-radar" },
    ],
    body: [
      "Angus the Nontechnical ran this analysis on TikTok as four prompts, and I rebuilt it so code fetches every number and Claude Sonnet only makes the call, which keeps each month comparable with the last.",
      "Two more stages clone Situational Awareness LP's latest 13F and check a portfolio's exposure to the bottleneck through a read-only IBKR Flex query. GitHub Actions publishes the results each month as a static dashboard.",
    ],
  },
  {
    slug: "game-of-society",
    title: "Wade's Game of Society",
    summary: "A 3D Game of Life where cells become organisms, then societies with leaders.",
    kind: "Research",
    image: {
      src: "/work/syntropy.webp",
      width: 1000,
      height: 625,
      alt: "Clusters of coloured organisms spread through a 3D lattice, a few labelled with group names",
    },
    stack: ["Three.js", "Node"],
    links: [
      { label: "Open the live site", href: "https://syntropy-sim.vercel.app/" },
      { label: "View the code", href: "https://github.com/JoshW-dev/syntropy" },
    ],
    body: [
      "A 3D take on Conway's Game of Life that keeps climbing after the cells. Coloured cells on a lattice settle into forms, and each form that holds its shape comes loose as an organism built from exactly those cells while the rest of the lattice keeps running.",
      "Organisms eat, grow, split and fight, and every few seconds each one makes the same choice: follow whoever keeps it safest after the tax it would pay, or follow no one. Nothing in the code mentions tribes, ranks, takeovers or heirs, yet all 48 seeded worlds I tested climbed from kin groups to hierarchies that take in other lineages, and then to groups that regroup under a new leader when the old one dies. At normal speed that takes about a minute.",
      "I wrote it up as a 15-page paper with the math, the ablations and a phase diagram, and every number in it comes from experiments the repo reruns headless in Node. It runs in the browser with Three.js, every world has a seed in the URL, and you can click any organism to see the choice it is weighing, or change the food, the water and the climate and watch a different society form.",
    ],
  },
  {
    slug: "duskmere",
    title: "Duskmere",
    summary: "Pixel-art dark fantasy RPG for the browser, with every asset made in code.",
    kind: "Game",
    image: {
      src: "/work/duskmere.webp",
      width: 1000,
      height: 625,
      alt: "A burning torch in the foreground and a pixel-art castle on a hill at dusk",
    },
    stack: ["Three.js", "Web Audio API"],
    links: [{ label: "Open the live site", href: "https://playduskmere.vercel.app/" }],
    body: [
      "A first-person pixel-art dark fantasy RPG that runs in the browser. You walk up a valley at dusk toward Hollowspire, where the Hollow King has woken, with a torch that burns down in one hand and a sword in the other.",
      "Every texture, model, sound effect and bar of music is generated in code with Three.js and the Web Audio API, so the game has no asset files. The pixel look comes from rendering to a small target, then adding outlines and dithered shading in one pass.",
      "A jab of the torch sets the dead alight along with trees, fences and dry grass, and the fire spreads with the wind. There's a bow whose arrows stick where they hit, crafting at any fire, fire magic learned from a hermit on the west ridge, and four floors under the castle laid out fresh from each run's seed down to the King's throne. The valley's merchants keep shop hours and prices that move with what you sell, and deer, rabbits and birds scatter as you come close.",
    ],
  },
  {
    slug: "quiet-order",
    title: "The Quiet Order",
    summary: "You run a secret society, and everything that grows it also exposes you.",
    kind: "Game",
    image: {
      src: "/work/quiet-order.webp",
      width: 1000,
      height: 625,
      alt: "The Quiet Order's game screens: a city map, a turn counter and the council's briefings",
    },
    links: [{ label: "Open the live site", href: "https://quiet-order.vercel.app/" }],
    body: [
      "A turn-based strategy game about running a secret society, where everything you do to grow it is the same thing that exposes you. You buy seats inside institutions and put your own people in them, and four investigators turn the trace you leave into evidence that ends the run once it reaches print.",
      "The simulation is a pure deterministic core with a seeded RNG, so a run replays exactly and the balance harness means something: it plays scripted policies and reports whether there is a game in there at all. It has already caught a missing rung in the Standing ladder that quietly made both victory conditions unreachable, an economy that stopped being a constraint around turn sixty, and a final act that resolved as a shopping trip instead of the siege it was written to be.",
    ],
  },
  {
    slug: "in-search-of-light",
    title: "In Search of Light",
    summary: "Helen McNicoll's paintings, animated in the browser along her own brushstrokes.",
    kind: "Art",
    image: {
      src: "/work/mcnicoll.webp",
      width: 1000,
      height: 630,
      alt: "A Helen McNicoll painting of a woman in white in a sunlit garden, under the title In Search of Light",
    },
    links: [{ label: "Open the live site", href: "https://mcnicoll-light.vercel.app/" }],
    body: [
      "Eighteen Helen McNicoll paintings animated live in the browser and strung along the years she painted them.",
      "For every canvas the renderer builds a structure tensor from the image gradients and moves pixels along its minor eigenvector, which points down the length of her own brushstrokes, so wind crosses a field the way she painted it crossing while faces and figures hold still.",
      "Her canvases are not shaped like a screen, so each one was extended past its own edges by an outpainting pass and her untouched scan composited back over the middle at full resolution.",
    ],
  },
  {
    slug: "eigenvirtue",
    title: "Eigenvirtue",
    summary: "Pulls a single axis for virtue out of a language model's embedding space.",
    kind: "Research",
    image: {
      src: "/work/eigenvirtue.webp",
      width: 1000,
      height: 500,
      alt: "A fan of arrows plotting the virtue direction beside a bust of Socrates and a line from Plato's Meno",
    },
    links: [{ label: "View the code", href: "https://github.com/JoshW-dev/eigenvirtue" }],
    body: [
      "Can you compute a mathematical representation of virtue? Eigenvirtue extracts the dominant direction of any abstract concept from a language model's embedding space, using virtue as the worked example: 61 virtue/vice sentence pairs built on Aristotle's table, one SVD, and an axis that recognizes virtues it was never fit on and ranks unpleasant honesty above pleasant flattery.",
      "Includes a paper-style write-up, full figures, and a responsible run of the original eigenslur question that inspired it.",
    ],
  },
  {
    slug: "convert2epub",
    title: "Convert2EPUB",
    summary: "PDF to EPUB and back, without your file ever leaving the browser.",
    kind: "Tool",
    image: {
      src: "/work/convert2epub.webp",
      width: 1000,
      height: 625,
      alt: "The PDF to EPUB converter page with title and author fields above a drop zone",
    },
    stack: ["PDF.js", "Tesseract.js", "jsPDF"],
    links: [
      { label: "Open the live site", href: "https://convert2epub.online" },
      { label: "View the code", href: "https://github.com/JoshW-dev/pdf-to-epub" },
    ],
    body: [
      "Free, privacy-first ebook converters that run entirely in your browser: no uploads, no servers, no accounts, so your files never leave your device.",
      "Turn a fixed-layout PDF into a reflowable EPUB (with OCR for scanned books and automatic chapter detection), or lay an EPUB out into a clean, paginated PDF with selectable text. Built with PDF.js, Tesseract.js, and jsPDF, all running client-side.",
    ],
  },
  {
    slug: "somebody-built-this",
    title: "Somebody Built This",
    summary: "Search a directory of small indie apps that each do one job well.",
    kind: "Product",
    image: {
      src: "/work/somebodybuiltthis.webp",
      width: 1000,
      height: 584,
      alt: "Somebody Built This home page with a search box and editor's picks below it",
    },
    links: [{ label: "Open the live site", href: "https://somebodybuiltthis.vercel.app/" }],
    body: [
      "A searchable index of small, focused indie apps that do one thing well: scheduling, analytics, forms, whiteboards, and the odd corner of the internet. If somebody built it, it's here. If not, go build it.",
    ],
  },
  {
    slug: "founderrise",
    title: "FounderRise",
    summary: "A startup mentor that guides founders stage by stage, from zero to revenue.",
    kind: "Product",
    image: {
      src: "/work/founderrise.webp",
      width: 1000,
      height: 517,
      alt: "FounderRise home page with an email signup beside a photo of founders at a meetup",
    },
    links: [{ label: "Open the live site", href: "https://www.founder-rise.com/" }],
    body: [
      "AI-powered startup mentor and roadmap guiding founders from zero to revenue on the path to $100M valuation.",
      "Provides step-by-step guidance through each startup stage with tailored assets like Lean Canvases and marketing strategies that help founders validate smarter, build faster, and raise capital.",
    ],
  },
  {
    slug: "mymcat",
    title: "MyMCAT.ai",
    summary: "MCAT prep built as a clinic game, with an AI cat named Kalypso.",
    kind: "Product",
    industry: "Education",
    image: {
      src: "/work/mymcat.webp",
      width: 1000,
      height: 578,
      alt: "An isometric clinic game board beside a leaderboard, with Kalypso the cat at the top",
    },
    links: [{ label: "Open the live site", href: "https://mymcat.ai" }],
    body: [
      "MCAT prep platform that gamifies learning through AI-powered personalization and an engaging personal clinic game environment.",
      "Features include intelligent tutoring, behavioral insights, and Kalypso, an AI companion cat that enhances student engagement.",
    ],
  },
  {
    slug: "feedbacker",
    title: "Feedbacker AI",
    summary: "Paste in a draft email and get feedback on how to improve it.",
    kind: "Product",
    image: {
      src: "/work/feedbacker.webp",
      width: 1000,
      height: 606,
      alt: "Three-step diagram showing a draft going in, feedback coming back, then a chat to review it",
    },
    links: [{ label: "Watch the demo", href: "https://www.youtube.com/watch?v=z3b7Iapg6_8" }],
    body: [
      "Your personal writing coach, designed to help you communicate like a master. Instant expert guidance and advice for improving emails, and professional writing.",
    ],
  },
  {
    slug: "local-llm",
    title: "Local LLM",
    summary: "Runs an open-source language model on your own machine, from the command line.",
    kind: "Tool",
    image: {
      src: "/work/localLLM.webp",
      width: 1000,
      height: 620,
      alt: "Terminal output loading a GPT4All model, followed by a short chat with it",
    },
    stack: ["Python"],
    links: [
      { label: "Watch the demo", href: "https://youtu.be/CL8GoBnLB90" },
      { label: "View the code", href: "https://github.com/JoshW-dev/local-LLM" },
    ],
    body: [
      "Lightweight chatbot designed to allow users to run open-source Large Language Models locally via a Python API. This makes it possible to chat with the LLM directly from the command line without an internet connection or external bias.",
    ],
  },
  {
    slug: "adam",
    title: "Adam, the AI news artist",
    summary: "An agent that reads the day's news and posts a painting about it.",
    kind: "Art",
    image: {
      src: "/work/adam.webp",
      width: 1000,
      height: 620,
      alt: "A post from the Adam bot with two AI-painted portraits beside a news caption",
    },
    stack: ["Python", "Twitter API", "Stable Diffusion", "GPT"],
    links: [
      { label: "See it on X", href: "https://twitter.com/ai_adam_" },
      { label: "View the code", href: "https://github.com/JoshW-dev/adam" },
    ],
    body: [
      "Fully autonomous AI agent, sharing digital paintings and daily news. The Adam bot webscrapes and reads news articles, creates art and shares relevant content on social media platforms.",
      "Operation and social media posting created with Python, using Twitter API, stable diffusion and GPT.",
    ],
  },
  {
    slug: "investor-assistant",
    title: "Investor Assistant AI",
    summary: "Answers personal investing questions in five languages.",
    kind: "Product",
    industry: "Finance",
    image: {
      src: "/work/investorchatbot.webp",
      width: 1000,
      height: 620,
      alt: "Investor Assistant AI's chat window opening with a greeting and sample questions",
    },
    links: [{ label: "Open the live site", href: "https://investor-assistant.zapier.app/" }],
    body: [
      "Custom-made chatbot designed to guide users in personal investing. Trained on an extensive investment knowledge base, it can answer queries from 'What is a mutual fund?' to 'How does compound interest work?'.",
      "Capable of communicating in English, Spanish, French, Chinese, and Russian, Invest Assistant is your multilingual guide to the world of investing.",
    ],
  },
  {
    slug: "ai-education-assistant",
    title: "AI Education Assistant Platform",
    summary: "A learning platform for students and educators, built on IBM Watson.",
    kind: "Work",
    industry: "Education",
    years: "2019",
    image: {
      src: "/work/aiChatBot.webp",
      width: 1000,
      height: 597,
      alt: "Architecture diagram linking a React front end and Node.js services to IBM Watson and MongoDB",
    },
    stack: ["React.js", "Node.js", "Kubernetes", "Docker", "IBM Watson", "Python"],
    links: [{ label: "Open cac.queensu.ca", href: "https://cac.queensu.ca/" }],
    body: [
      "Full stack design and development of an AI-assisted academic learning web platform (2019). Created with React.js, Node.js, Kubernetes, Docker, IBM-Watson and Python NLP libraries. Created for the Centre for Advanced Computing.",
    ],
  },
  {
    slug: "cubesat",
    title: "Queen\u2019s CubeSat",
    summary: "I led 35 students designing a 3U satellite that points a camera at Earth.",
    kind: "Engineering",
    industry: "Space",
    years: "2019 to 2021",
    image: {
      src: "/work/cubesat.webp",
      width: 1000,
      height: 631,
      alt: "Table of the satellite's control modes above a block diagram of its reaction wheel control loop",
    },
    stack: ["MATLAB", "Simulink"],
    frame: {
      src: "/film/clips/orbit-rockies-first.webp",
      alt: "Earth from low orbit, with snow on the Rockies and city lights on the night side",
    },
    links: [
      { label: "Open qset.ca", href: "https://qset.ca/satellite/" },
      { label: "View the code", href: "https://github.com/queens-satellite-team" },
    ],
    body: [
      "At Queen\u2019s I worked on the university\u2019s satellite team, and in my last year I was its chief technical officer, leading 35 students through the design and build of a 3U CubeSat.",
      "My own part was the ADCS, the attitude determination and control system that works out which way the satellite is facing and turns it. The payload was a camera, so pointing was the mission. I built a real-time simulation of the control loop in MATLAB and Simulink, so we could test it before any hardware turned.",
      "We presented the design at the Canadian Satellite Design Challenge\u2019s Critical Design Review in 2019, where each university team defends its satellite in front of a panel of judges.",
    ],
  },
  {
    slug: "bose-ar",
    title: "Bose AR volume control",
    summary: "Bose glasses that turn your music down when you turn your head.",
    kind: "Engineering",
    industry: "Audio",
    years: "2019",
    image: {
      src: "/work/bose-ar.webp",
      width: 1000,
      height: 625,
      alt: "Three frames of the hackathon demo in Bose Frames: head turned left with the phone showing Aware and the music muted, facing forward with it showing Focused, then turned right and muted again",
    },
    stack: ["Java", "Android", "Bose AR SDK"],
    links: [
      { label: "Open the Devpost page", href: "https://devpost.com/software/bose-ar-hands-free-voice-free-volume-control" },
      { label: "View the code", href: "https://github.com/JoshW-dev/BostonHack-Bose" },
    ],
    body: [
      "At BostonHacks 2019, three of us built an Android app for Bose Frames, the sunglasses with speakers and motion sensors in the arms. It won the Bose Challenge.",
      "My part was the sensor side. The glasses report which way they\u2019re facing as a quaternion, and I wrote the logic that remembers where forward is, compares each new reading against it, and works out how far the head has turned and tilted. It\u2019s the same kind of maths I was using on the satellite team that year.",
      "We kept building on it for a few months after the hackathon.",
    ],
  },
  {
    slug: "production-lines",
    title: "Two production lines",
    summary: "An 8-week push that cut downtime 35% on two production lines.",
    kind: "Work",
    industry: "Manufacturing",
    years: "2021 to 2023",
    image: {
      src: "/film/04-line.webp",
      width: 1344,
      height: 752,
      alt: "Illustration of a carton packaging line, seen low along the conveyor",
    },
    frame: {
      src: "/film/04-line.webp",
      alt: "Illustration of a carton packaging line, seen low along the conveyor",
    },
    links: [],
    body: [
      "As an engineering consultant I led an improvement team on two production lines, in Texas and California.",
      "The first talk I made for Sketch Deck, about putting AI on a business’s bottleneck, comes out of this work.",
    ],
  },
  {
    slug: "fpso",
    title: "FPSO refurbishment",
    summary: "Logistics and scheduling tools for a vessel refit, cutting delays by over a month.",
    kind: "Work",
    industry: "Energy",
    image: {
      src: "/work/04.webp",
      width: 1000,
      height: 634,
      alt: "A rusted ship hull in dry dock with workers in hard hats beside it",
    },
    links: [],
    body: [
      "Developed major logistics assessment and scheduling tools for the execution of a floating production storage and offloading (FPSO) vessel refurbishment project, reducing project delays by over a month.",
    ],
  },
  {
    slug: "masterpiece-pets",
    title: "Masterpiece Pets",
    summary: "Pet portraits in classic painting styles, made with Stable Diffusion.",
    kind: "Art",
    image: {
      src: "/work/pets.webp",
      width: 1000,
      height: 840,
      alt: "A sleeping spaniel shown twice, repainted in the style of Van Gogh",
    },
    links: [{ label: "See it on Instagram", href: "https://www.instagram.com/masterpiecepets/" }],
    body: [
      "Using stable diffusion algorithms and diverse artistic styles to create bespoke portraits of pets and animals.",
    ],
  },
  {
    slug: "abstract-painting",
    title: "Abstract Painting",
    summary: "Poured acrylic paintings where gravity does most of the work.",
    kind: "Art",
    image: {
      src: "/work/paints.webp",
      width: 1000,
      height: 635,
      alt: "Three poured acrylic paintings with swirls of red, blue and gold",
    },
    links: [{ label: "See it on Instagram", href: "https://www.instagram.com/paintsepii/" }],
    body: [
      "Making spontaneous, unpredictable pieces with acrylics, latex, canvas and gravity. A great way to relax while being creative!",
    ],
  },
];

/** Display order: Josh's own ranking, with his own projects first. */
const order = [
  "cubesat",
  "hydrogen-plant",
  "production-lines",
  "alltus",
  "disco",
  "crimsonlead",
  "bottleneck-radar",
  "bose-ar",
  "fastform",
  "openaffect",
  "highstyle",
  "insider-signal",
  "game-of-society",
  "sketch-deck",
  "in-search-of-light",
  "eigenvirtue",
  "quiet-order",
  "duskmere",
  "convert2epub",
  "somebody-built-this",
  "founderrise",
  "mymcat",
  "feedbacker",
  "local-llm",
  "adam",
  "investor-assistant",
  "ai-education-assistant",
  "fpso",
  "masterpiece-pets",
  "abstract-painting",
];

export const work: Work[] = [
  ...order.map((slug) => entries.find((w) => w.slug === slug)).filter((w): w is Work => !!w),
  ...entries.filter((w) => !order.includes(w.slug)),
];

export function getWork(slug: string): Work | undefined {
  return work.find((w) => w.slug === slug);
}

const kindOrder: WorkKind[] = [
  "Product",
  "Research",
  "Game",
  "Art",
  "Tool",
  "Work",
  "Engineering",
];

/** Kinds that occur in `work`, in display order. */
export const kinds: WorkKind[] = kindOrder.filter((k) => work.some((w) => w.kind === k));
