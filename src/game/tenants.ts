import { hashString } from "./hash";
import { personName } from "./names";
import { DEFAULT_ARCHETYPE } from "./archetypes";
import type { Tenant, UnitKind, Worker } from "./types";

/**
 * Tenants — the businesses/households that occupy revenue rooms. Pure and
 * deterministic: a room's tenant identity is a function of its stable id, so it
 * never changes once assigned.
 *
 * Each revenue kind has SUBSETS (a software firm, a law office, a taquería, a
 * dentist…). A subset carries its hours/days and a combinatorial name generator
 * that yields 100+ appropriate names. The chosen subset id is stored on the
 * tenant and drives its furniture (see renderer.ts).
 */

const WEEKDAYS = [0, 1, 2, 3, 4]; // Mon–Fri
const MON_SAT = [0, 1, 2, 3, 4, 5];
const ALL_WEEK = [0, 1, 2, 3, 4, 5, 6];
const NOT_MONDAY = [1, 2, 3, 4, 5, 6];

// --- word pools ------------------------------------------------------------

const SUR = [
  "Halbrook", "Vance", "Sterling", "Meridian", "Ashcroft", "Kessler", "Oakmont", "Marlowe",
  "Copperfield", "Whitlock", "Larkspur", "Brenner", "Cavendish", "Fairmont", "Delacroix", "Ridgeway",
  "Blackwood", "Hartley", "Verity", "Winslow", "Ashby", "Calloway", "Merrick", "Prescott",
  "Thorne", "Sable", "Hollis", "Ellery", "Fenwick", "Garrick", "Lockwood", "Norwood",
  "Pemberton", "Rutherford", "Sinclair", "Trevelyan", "Underwood", "Wexford", "Bramwell", "Caldwell",
];
const PLACE = [
  "Riverside", "Oakwood", "Fairview", "Lakeside", "Highland", "Brookdale", "Cedar", "Maple",
  "Summit", "Parkview", "Bayside", "Ashgrove", "Westgate", "Northshore", "Elmwood", "Glenwood",
  "Hillcrest", "Meadowbrook", "Sunnyvale", "Kingsley", "Ravenwood", "Beacon", "Harbor", "Crestline",
];
const TECH = [
  "Cortex", "Nimbus", "Quantum", "Vertex", "Hypernova", "Bytewave", "Nexus", "Pixel",
  "Cipher", "Fathom", "Lumen", "Synth", "Zenith", "Photon", "Cascade", "Ionic",
  "Datum", "Orbital", "Kernel", "Flux", "Vector", "Nova", "Helix", "Axiom",
  "Pulsar", "Quark", "Sonar", "Turing",
];
const TECH_SFX = ["Labs", "Systems", "Software", "Technologies", "Digital", "Dynamics", "Cloud", "AI", "Logic", "Works"];
const MEX = [
  "Sol", "Toro", "Maguey", "Fuego", "Corazón", "Azteca", "Cactus", "Loma", "Río", "Playa",
  "Sierra", "Jalapeño", "Mariachi", "Sombrero", "Coyote", "Nopal", "Agave", "Barrio", "Cielo",
  "Pueblo", "Verde", "Dorado", "Luna", "Paloma", "Mesa", "Tierra",
];
const CHN = [
  "Dragon", "Phoenix", "Lotus", "Bamboo", "Jade", "Golden", "Panda", "Mandarin", "Lucky", "Imperial",
  "Peking", "Orchid", "Pearl", "Crane", "Tiger", "Dynasty", "Willow", "Fortune", "Silk", "Peony",
  "Koi", "Wong", "Chang", "Ming", "Red Lantern", "Jasmine",
];
const PIZ = [
  "Tony", "Luigi", "Mario", "Napoli", "Bella", "Vesuvio", "Roma", "Sorrento", "Palermo", "Vino",
  "Nonna", "Salvatore", "Giovanni", "Aria", "Amico", "Ciao", "Milano", "Verona", "Trevi", "Rustica",
  "Forno", "Basilico", "Toscana", "Emilio", "Angelo", "Vito",
];
const AME = [
  "Route 66", "Hometown", "Liberty", "Star", "Eagle", "Big Sky", "Main Street", "Sunrise", "Bluebird",
  "Silver Dollar", "Frontier", "Homestead", "Lucky", "Old Glory", "Blue Plate", "Copper", "Ridgeline",
  "Prairie", "Cornerstone", "Redwood", "Anchor", "Sundance", "Maple Leaf", "Whistlestop",
];
const JPN = [
  "Sakura", "Tsunami", "Kaito", "Fuji", "Sora", "Hana", "Nori", "Umami", "Kenzo", "Yumi",
  "Aki", "Hoshi", "Mizu", "Zen", "Tako", "Kaze", "Ryu", "Nami", "Ginza", "Osaka",
  "Kyoto", "Hikari", "Momo", "Sango",
];
const CAF = [
  "Rise", "Grind", "Ember", "Roast", "Steamy", "Percolate", "Aroma", "Velvet", "Amber", "Daybreak",
  "Cocoa", "Mocha", "Crema", "Fern", "Larkspur", "Willow", "Copper", "Maple", "Dandelion", "Nectar",
  "Hazel", "Juniper", "Cardamom", "Sparrow",
];
const FASH = [
  "Vogue", "Atelier", "Muse", "Velour", "Silhouette", "Ivory", "Noir", "Verve", "Luxe", "Mode",
  "Chic", "Sable", "Coco", "Blanc", "Rue", "Étoile", "Wren", "Linen", "Marlowe", "Plume",
  "Vesper", "Haven", "Gilt", "Marigold",
];
const BOOK = [
  "Chapter", "Marginalia", "Inkwell", "Foxed Page", "Ampersand", "Turnstile", "Ex Libris", "Dog-Eared",
  "Broadside", "Vellum", "Quire", "Colophon", "Prologue", "Bindery", "Folio", "Almanac", "Verso",
  "Signet", "Storyline", "Booksmith", "Novella", "Athenaeum", "Paperback", "Rook",
];
const CONV = [
  "Corner", "Quick", "Daily", "Rapid", "Nite Owl", "Handy", "City", "Metro", "Sunrise", "Express",
  "Cornerstone", "Pit Stop", "Junction", "Depot", "Roundabout", "Beacon", "Wayside", "Uptown",
  "Downtown", "Central", "Village", "Harbor", "Midtown", "Crossroads",
];
const BAKE = [
  "Flour", "Rise", "Crumb", "Hearth", "Butter", "Golden", "Sweet", "Levain", "Batch", "Whisk",
  "Sugarplum", "Honeycomb", "Poppy", "Cinnamon", "Vanilla", "Almond", "Maple", "Custard", "Yeast",
  "Baguette", "Praline", "Brioche", "Marzipan", "Kneaded",
];
const MEDIA = [
  "Pixel", "Neon", "Vireo", "Static", "Aperture", "Kinetic", "Lumina", "Echo", "Cobalt", "Marquee",
  "Ampersand", "Reel", "Verve", "Halo", "Prism", "Mercury", "Vanta", "Beacon", "Signal", "Onyx",
  "Radiant", "Vertex", "Sable", "Meridian",
];

// --- name builder ----------------------------------------------------------

type Pick = (pool: string[], salt: number) => string;

/**
 * Build a deterministic name generator from a set of templates. Each template
 * picks words from pools; the template + word choices vary with the hash, so a
 * handful of templates over ~24-word pools yields well over 100 distinct names.
 */
function nameGen(templates: ((p: Pick) => string)[]): (h: number) => string {
  return (h: number) => {
    const pick: Pick = (pool, salt) => pool[((h ^ ((salt + 1) * 2654435761)) >>> 0) % pool.length];
    return templates[h % templates.length](pick);
  };
}

interface Subset {
  id: string;
  label: string;
  open: number;
  close: number;
  days?: number[];
  name: (h: number) => string;
}

// --- subsets per kind ------------------------------------------------------

const SUBSETS: Partial<Record<UnitKind, Subset[]>> = {
  office: [
    { id: "software", label: "Software Studio", open: 10, close: 20, days: WEEKDAYS, name: nameGen([(p) => `${p(TECH, 0)} ${p(TECH_SFX, 1)}`, (p) => `${p(TECH, 2)}${p(TECH, 3).slice(0, 3)}`, (p) => `${p(TECH, 4)} ${p(TECH_SFX, 5)}`]) },
    { id: "law", label: "Law Offices", open: 8, close: 18, days: WEEKDAYS, name: nameGen([(p) => `${p(SUR, 0)} & ${p(SUR, 1)} LLP`, (p) => `${p(SUR, 2)}, ${p(SUR, 3)} & ${p(SUR, 4)}`, (p) => `${p(SUR, 5)} Law Group`]) },
    { id: "accounting", label: "Accounting Firm", open: 8, close: 17, days: WEEKDAYS, name: nameGen([(p) => `${p(SUR, 0)} & Co CPAs`, (p) => `${p(SUR, 1)} Accounting`, (p) => `${p(SUR, 2)} Tax Advisors`, (p) => `${p(SUR, 3)} Financial`]) },
    { id: "insurance", label: "Insurance Agency", open: 9, close: 17, days: WEEKDAYS, name: nameGen([(p) => `${p(SUR, 0)} Insurance`, (p) => `${p(SUR, 1)} Assurance`, (p) => `${p(SUR, 2)} Underwriters`, (p) => `${p(PLACE, 3)} Mutual`]) },
    { id: "consulting", label: "Consulting Group", open: 9, close: 18, days: WEEKDAYS, name: nameGen([(p) => `${p(SUR, 0)} Consulting`, (p) => `${p(SUR, 1)} & Partners`, (p) => `${p(SUR, 2)} Advisory`, (p) => `${p(SUR, 3)} Strategy`]) },
    { id: "realty", label: "Realty Group", open: 9, close: 19, days: ALL_WEEK, name: nameGen([(p) => `${p(SUR, 0)} Realty`, (p) => `${p(PLACE, 1)} Properties`, (p) => `${p(SUR, 2)} Estates`, (p) => `${p(PLACE, 3)} Realtors`]) },
    { id: "architecture", label: "Architecture Studio", open: 9, close: 18, days: WEEKDAYS, name: nameGen([(p) => `${p(SUR, 0)} Architects`, (p) => `${p(SUR, 1)} & Associates`, (p) => `${p(SUR, 2)} Design Studio`]) },
    { id: "media", label: "Media Agency", open: 10, close: 19, days: WEEKDAYS, name: nameGen([(p) => `${p(MEDIA, 0)} Media`, (p) => `${p(MEDIA, 1)} Studios`, (p) => `${p(MEDIA, 2)} Creative`, (p) => `${p(MEDIA, 3)} Agency`]) },
  ],
  medical: [
    { id: "primary", label: "Family Practice", open: 8, close: 17, days: WEEKDAYS, name: nameGen([(p) => `${p(SUR, 0)} Family Practice`, (p) => `${p(PLACE, 1)} Medical`, (p) => `${p(SUR, 2)} Health Clinic`]) },
    { id: "dental", label: "Dental Clinic", open: 8, close: 16, days: MON_SAT, name: nameGen([(p) => `${p(SUR, 0)} Dental`, (p) => `${p(PLACE, 1)} Dental Care`, (p) => `${p(SUR, 2)} Orthodontics`]) },
    { id: "optometry", label: "Optometry Clinic", open: 9, close: 17, days: MON_SAT, name: nameGen([(p) => `${p(SUR, 0)} Eye Care`, (p) => `${p(PLACE, 1)} Optical`, (p) => `${p(SUR, 2)} Vision`]) },
    { id: "physio", label: "Physical Therapy", open: 7, close: 19, days: WEEKDAYS, name: nameGen([(p) => `${p(SUR, 0)} Physical Therapy`, (p) => `${p(PLACE, 1)} Rehab`, (p) => `${p(SUR, 2)} Sports Medicine`]) },
    { id: "pediatrics", label: "Pediatrics Clinic", open: 8, close: 17, days: WEEKDAYS, name: nameGen([(p) => `${p(SUR, 0)} Pediatrics`, (p) => `${p(PLACE, 1)} Children's Clinic`]) },
    { id: "dermatology", label: "Dermatology Clinic", open: 9, close: 17, days: WEEKDAYS, name: nameGen([(p) => `${p(SUR, 0)} Dermatology`, (p) => `${p(PLACE, 1)} Skin Clinic`]) },
  ],
  store: [
    { id: "apparel", label: "Apparel", open: 10, close: 20, days: ALL_WEEK, name: nameGen([(p) => `${p(FASH, 0)} Apparel`, (p) => `${p(FASH, 1)} Boutique`, (p) => `${p(FASH, 2)} & Co`, (p) => `House of ${p(FASH, 3)}`]) },
    { id: "bookstore", label: "Bookshop", open: 10, close: 20, days: ALL_WEEK, name: nameGen([(p) => `${p(BOOK, 0)} Books`, (p) => `${p(BOOK, 1)} Booksellers`, (p) => `The ${p(BOOK, 2)} Page`, (p) => `${p(BOOK, 3)} & Quill`]) },
    { id: "convenience", label: "Convenience Store", open: 6, close: 24, days: ALL_WEEK, name: nameGen([(p) => `${p(CONV, 0)} Market`, (p) => `${p(CONV, 1)} Mart`, (p) => `${p(CONV, 2)} Corner Store`, (p) => `Quick ${p(CONV, 3)}`]) },
    { id: "electronics", label: "Electronics", open: 10, close: 21, days: ALL_WEEK, name: nameGen([(p) => `${p(TECH, 0)} Electronics`, (p) => `${p(TECH, 1)} Gadgets`, (p) => `${p(TECH, 2)} Tech`]) },
    { id: "pharmacy", label: "Pharmacy", open: 8, close: 22, days: ALL_WEEK, name: nameGen([(p) => `${p(SUR, 0)} Pharmacy`, (p) => `${p(PLACE, 1)} Drugs`, (p) => `${p(SUR, 2)} Apothecary`]) },
    { id: "bakery", label: "Bakery", open: 7, close: 18, days: MON_SAT, name: nameGen([(p) => `${p(BAKE, 0)} Bakery`, (p) => `${p(BAKE, 1)} Bread Co`, (p) => `Sweet ${p(BAKE, 2)}`, (p) => `${p(BAKE, 3)} Patisserie`]) },
  ],
  restaurant: [
    { id: "mexican", label: "Mexican", open: 11, close: 23, days: ALL_WEEK, name: nameGen([(p) => `El ${p(MEX, 0)}`, (p) => `Casa ${p(MEX, 1)}`, (p) => `${p(MEX, 2)} Cantina`, (p) => `Taquería ${p(MEX, 3)}`, (p) => `Los ${p(MEX, 4)}`]) },
    { id: "chinese", label: "Chinese", open: 11, close: 23, days: ALL_WEEK, name: nameGen([(p) => `${p(CHN, 0)} Palace`, (p) => `Golden ${p(CHN, 1)}`, (p) => `${p(CHN, 2)} Garden`, (p) => `${p(CHN, 3)} Wok`, (p) => `Jade ${p(CHN, 4)}`]) },
    { id: "pizza", label: "Pizzeria", open: 11, close: 24, days: ALL_WEEK, name: nameGen([(p) => `${p(PIZ, 0)}'s Pizza`, (p) => `${p(PIZ, 1)} Pizzeria`, (p) => `Pizza ${p(PIZ, 2)}`, (p) => `${p(PIZ, 3)} Slice`]) },
    { id: "american", label: "Diner", open: 7, close: 22, days: ALL_WEEK, name: nameGen([(p) => `${p(AME, 0)} Diner`, (p) => `The ${p(AME, 1)} Grill`, (p) => `${p(AME, 2)} Burger Co`, (p) => `${p(AME, 3)} Roadhouse`]) },
    { id: "sushi", label: "Sushi Bar", open: 12, close: 23, days: NOT_MONDAY, name: nameGen([(p) => `${p(JPN, 0)} Sushi`, (p) => `Sushi ${p(JPN, 1)}`, (p) => `${p(JPN, 2)}-ya`, (p) => `Ramen ${p(JPN, 3)}`]) },
    { id: "cafe", label: "Café", open: 7, close: 19, days: ALL_WEEK, name: nameGen([(p) => `${p(CAF, 0)} Café`, (p) => `Café ${p(CAF, 1)}`, (p) => `${p(CAF, 2)} Roasters`, (p) => `The ${p(CAF, 3)} Bean`]) },
  ],
  apartment: [
    { id: "residential", label: "Residences", open: 16, close: 24, days: ALL_WEEK, name: nameGen([(p) => `${p(SUR, 0)} Residences`, (p) => `The ${p(PLACE, 1)}`, (p) => `${p(PLACE, 2)} Lofts`]) },
  ],
  hotel: [
    { id: "hotel", label: "Suites", open: 14, close: 24, days: ALL_WEEK, name: nameGen([(p) => `${p(SUR, 0)} Suites`, (p) => `The ${p(PLACE, 1)} Inn`, (p) => `${p(PLACE, 2)} Hotel`]) },
  ],
  // Vending machines run 24/7; a route driver from the brand restocks weekly.
  vending: [
    { id: "snackman", label: "Snackman Snacks", open: 0, close: 24, days: ALL_WEEK, name: () => "Snackman Snacks" },
    { id: "redcola", label: "Red Cola", open: 0, close: 24, days: ALL_WEEK, name: () => "Red Cola" },
    { id: "bluecola", label: "Blue Cola", open: 0, close: 24, days: ALL_WEEK, name: () => "Blue Cola" },
    { id: "drdoctor", label: "Dr. Doctor", open: 0, close: 24, days: ALL_WEEK, name: () => "Dr. Doctor" },
  ],
};

/** Which weekday (0=Mon) each vending brand's route driver restocks. */
const VENDING_STOCK_DAY: Record<string, number> = { snackman: 0, redcola: 1, bluecola: 2, drdoctor: 3 };

/** People (employees or residents) per width tile, per kind. */
const HEADCOUNT: Partial<Record<UnitKind, number>> = {
  office: 4, medical: 3, store: 2, restaurant: 3, apartment: 2, hotel: 3,
};

// --- roles (job titles + daily salary) -------------------------------------

interface Role {
  title: string;
  salary: number;
}

/** Work-week patterns for apartment residents' (external) jobs. */
const RESIDENT_DAYS = [
  [0, 1, 2, 3, 4], // Mon–Fri
  [0, 1, 2, 3, 4], // Mon–Fri (weighted common)
  [0, 1, 2, 3, 4, 5], // Mon–Sat
  [1, 2, 3, 4, 5], // Tue–Sat
  [2, 3, 4, 5, 6], // Wed–Sun
  [0, 1, 3, 4, 5], // a day off midweek
];

/** The senior/lead role for each business subset (index-0 person gets this). */
const LEAD: Record<string, Role> = {
  // office
  software: { title: "Engineering Lead", salary: 600 },
  law: { title: "Managing Partner", salary: 950 },
  accounting: { title: "Managing Partner", salary: 720 },
  insurance: { title: "Agency Principal", salary: 560 },
  consulting: { title: "Principal", salary: 820 },
  realty: { title: "Managing Broker", salary: 620 },
  architecture: { title: "Principal Architect", salary: 700 },
  media: { title: "Creative Director", salary: 660 },
  // medical
  primary: { title: "Family Physician", salary: 820 },
  dental: { title: "Dentist", salary: 820 },
  optometry: { title: "Optometrist", salary: 720 },
  physio: { title: "Lead Therapist", salary: 560 },
  pediatrics: { title: "Pediatrician", salary: 800 },
  dermatology: { title: "Dermatologist", salary: 860 },
  // store
  apparel: { title: "Store Manager", salary: 360 },
  bookstore: { title: "Store Manager", salary: 340 },
  convenience: { title: "Store Manager", salary: 320 },
  electronics: { title: "Store Manager", salary: 400 },
  pharmacy: { title: "Pharmacist", salary: 620 },
  bakery: { title: "Head Baker", salary: 380 },
  // restaurant
  mexican: { title: "Head Chef", salary: 460 },
  chinese: { title: "Head Chef", salary: 460 },
  pizza: { title: "Head Chef", salary: 440 },
  american: { title: "Head Chef", salary: 440 },
  sushi: { title: "Head Sushi Chef", salary: 560 },
  cafe: { title: "Café Manager", salary: 340 },
  // dwellings — occupants don't have a job here, so no title/salary (see UI).
  residential: { title: "", salary: 0 },
  hotel: { title: "", salary: 0 },
};

/** Subset-specific staff roles for offices (the visible, simulated workers). */
const OFFICE_STAFF: Record<string, Role[]> = {
  software: [{ title: "Software Engineer", salary: 440 }, { title: "Product Manager", salary: 500 }, { title: "UX Designer", salary: 400 }, { title: "QA Engineer", salary: 360 }, { title: "Data Scientist", salary: 470 }],
  law: [{ title: "Attorney", salary: 640 }, { title: "Associate", salary: 440 }, { title: "Paralegal", salary: 300 }, { title: "Legal Secretary", salary: 240 }],
  accounting: [{ title: "CPA", salary: 480 }, { title: "Staff Accountant", salary: 360 }, { title: "Bookkeeper", salary: 280 }, { title: "Tax Analyst", salary: 360 }],
  insurance: [{ title: "Insurance Agent", salary: 340 }, { title: "Underwriter", salary: 420 }, { title: "Claims Adjuster", salary: 340 }, { title: "Actuary", salary: 500 }],
  consulting: [{ title: "Senior Consultant", salary: 560 }, { title: "Consultant", salary: 420 }, { title: "Analyst", salary: 340 }, { title: "Associate", salary: 360 }],
  realty: [{ title: "Realtor", salary: 360 }, { title: "Sales Agent", salary: 300 }, { title: "Property Manager", salary: 360 }, { title: "Leasing Agent", salary: 300 }],
  architecture: [{ title: "Architect", salary: 480 }, { title: "Designer", salary: 380 }, { title: "Drafter", salary: 320 }, { title: "Project Manager", salary: 460 }],
  media: [{ title: "Art Director", salary: 480 }, { title: "Copywriter", salary: 360 }, { title: "Designer", salary: 380 }, { title: "Account Manager", salary: 400 }, { title: "Producer", salary: 420 }],
};

/** Generic staff roles per kind (used for non-office businesses + fallback). */
const STAFF: Partial<Record<UnitKind, Role[]>> = {
  office: [{ title: "Associate", salary: 380 }, { title: "Analyst", salary: 340 }, { title: "Coordinator", salary: 300 }, { title: "Specialist", salary: 360 }],
  medical: [{ title: "Nurse", salary: 380 }, { title: "Medical Assistant", salary: 300 }, { title: "Receptionist", salary: 240 }, { title: "Technician", salary: 320 }],
  store: [{ title: "Sales Associate", salary: 220 }, { title: "Cashier", salary: 200 }, { title: "Stock Clerk", salary: 200 }],
  restaurant: [{ title: "Server", salary: 200 }, { title: "Line Cook", salary: 240 }, { title: "Host", salary: 190 }, { title: "Bartender", salary: 230 }, { title: "Dishwasher", salary: 180 }],
  apartment: [{ title: "", salary: 0 }],
  hotel: [{ title: "", salary: 0 }],
};

/** The staff role list for a business (subset-specific for offices). */
function staffRoles(kind: UnitKind, subId: string): Role[] {
  if (kind === "office") return OFFICE_STAFF[subId] ?? STAFF.office!;
  return STAFF[kind] ?? [{ title: "Staff", salary: 200 }];
}

/**
 * Build the roster of people for a tenant: the first is the senior/lead role,
 * the rest are staff. Names are region-appropriate (city archetype); salaries
 * carry a little per-person variance. All share the business's days + hours.
 */
function buildWorkers(
  kind: UnitKind,
  subId: string,
  seed: string,
  archetypeId: string,
  count: number,
  days: number[],
  open: number,
  close: number,
): Worker[] {
  // Apartment residents work an (unmodelled) job elsewhere: they get fake work
  // hours + days so the sim knows when they're out, but no title/salary.
  if (kind === "apartment") {
    const workers: Worker[] = [];
    for (let i = 0; i < count; i++) {
      const wh = hashString(`${seed}:w${i}`);
      const wStart = 6 + (wh % 5); // leave for a 6–10am start
      const wEnd = wStart + 8 + ((wh >>> 3) % 2); // an 8–9h day
      workers.push({
        name: personName(archetypeId, wh),
        title: "",
        dailySalary: 0,
        days: RESIDENT_DAYS[wh % RESIDENT_DAYS.length],
        startHour: wStart,
        endHour: wEnd,
        lunchHour: -1,
      });
    }
    return workers;
  }
  // Hotel guests have no schedule at all (name only).
  if (kind === "hotel") {
    const workers: Worker[] = [];
    for (let i = 0; i < count; i++) {
      const wh = hashString(`${seed}:w${i}`);
      workers.push({ name: personName(archetypeId, wh), title: "", dailySalary: 0, days: [], startHour: 0, endHour: 0, lunchHour: -1 });
    }
    return workers;
  }
  // Vending machine: no tower staff — just the brand's route driver, who restocks
  // once a week on the brand's day (paid by the vending company, so $0 wages here).
  if (kind === "vending") {
    const wh = hashString(`${seed}:stocker`);
    return [{
      name: personName(archetypeId, wh),
      title: "Route Driver",
      dailySalary: 0,
      days: [VENDING_STOCK_DAY[subId] ?? 2],
      startHour: 9,
      endHour: 17,
      lunchHour: -1,
    }];
  }

  const lead = LEAD[subId] ?? { title: "Manager", salary: 300 };
  const staff = staffRoles(kind, subId);
  const open7 = days.length === 7;
  const workers: Worker[] = [];
  let salt = 0;

  // A shift of `len` hours anchored at the open time (early) or the close time
  // (late), clamped to the actual open period. Staggering early/late covers long
  // open hours, and capping shift length keeps everyone under 50 hours a week.
  const span = Math.max(1, close - open);
  const early = (len: number) => ({ s: open, e: open + Math.min(len, span) });
  const late = (len: number) => ({ s: Math.max(open, close - Math.min(len, span)), e: close });

  const add = (title: string, baseSalary: number, wdays: number[], s: number, e: number): void => {
    const wh = hashString(`${seed}:w${salt++}`);
    const salary = baseSalary === 0 ? 0 : Math.round(baseSalary * (0.9 + ((wh >>> 5) % 20) / 100));
    const mid = Math.floor((s + e) / 2);
    const lunchHour = salary === 0 || e - s < 7 ? -1 : Math.max(s + 1, Math.min(e - 2, mid - 1 + ((wh >>> 9) % 3)));
    workers.push({ name: personName(archetypeId, wh), title, dailySalary: salary, days: wdays.slice(), startHour: s, endHour: e, lunchHour });
  };

  // --- Leadership ---
  if (open7) {
    // 7-day business: the lead works 4 × 11h; a secondary (junior) lead covers
    // the other 3 days plus 1 overlap day with the lead, also 11h.
    const l = early(11);
    add(lead.title, lead.salary, [0, 1, 2, 3], l.s, l.e); // Mon–Thu
    add(juniorTitle(lead.title), Math.round(lead.salary * 0.8), [3, 4, 5, 6], l.s, l.e); // Thu(overlap)–Sun
  } else {
    // Otherwise the lead works the open weekdays (capped at 5 days), ≤10h shifts.
    const l = early(10);
    add(lead.title, lead.salary, cappedDays(days, 0), l.s, l.e);
  }

  // --- Non-leadership staff ---
  const roles = open7 ? Math.max(1, Math.round((count - 1) / 2)) : Math.max(1, count - 1);
  for (let r = 0; r < roles; r++) {
    const role = staff[r % staff.length];
    const sh = r % 2 === 0 ? early(10) : late(10); // stagger early/late shifts
    if (open7) {
      // Each role is two people: one works four days, the other the opposite three.
      add(role.title, role.salary, [0, 1, 2, 3], sh.s, sh.e);
      add(role.title, role.salary, [4, 5, 6], sh.s, sh.e);
    } else {
      add(role.title, role.salary, cappedDays(days, r + 1), sh.s, sh.e);
    }
  }
  return workers;
}

/**
 * No one works more than five days a week. Businesses open five days or fewer
 * keep their whole week; a six-day business drops one day per person (staggered
 * by worker index) so the week still gets covered.
 */
function cappedDays(openDays: number[], workerIdx: number): number[] {
  if (openDays.length <= 5) return openDays.slice();
  const drop = workerIdx % openDays.length;
  return openDays.filter((_, i) => i !== drop);
}

/** A subordinate version of a leadership title, for a part-time day-off cover. */
function juniorTitle(title: string): string {
  const map: Record<string, string> = {
    "Store Manager": "Assistant Manager",
    "Café Manager": "Assistant Manager",
    "Managing Broker": "Associate Broker",
    "Managing Partner": "Junior Partner",
    "Pharmacist": "Pharmacy Technician",
    "Head Chef": "Sous Chef",
    "Head Sushi Chef": "Sushi Chef",
    "Head Baker": "Assistant Baker",
    "Engineering Lead": "Junior Engineer",
    "Creative Director": "Associate Creative",
    "Principal Architect": "Associate Architect",
    "Agency Principal": "Associate Agent",
  };
  if (map[title]) return map[title];
  if (/\bhead\b/i.test(title)) return title.replace(/\bhead\b/i, "Assistant");
  if (/\blead\b/i.test(title)) return "Junior " + title.replace(/\s*\blead\b/i, "").trim();
  return "Assistant " + title;
}

/** Base daily rent per kind (scaled by appeal + a little variance). */
const RENT_BASE: Partial<Record<UnitKind, number>> = {
  office: 1400, medical: 1800, store: 1200, restaurant: 1600, apartment: 1000, hotel: 620, vending: 320,
};

/** Whether a kind can hold a tenant at all. */
export function hasTrades(kind: UnitKind): boolean {
  return kind in SUBSETS;
}

/**
 * Deterministically generate the tenant for a room from its stable `seed`
 * (plot + unit id). Picks an appropriate subset, then a name from that subset's
 * pool, and a roster of people (region-appropriate names per `archetypeId`).
 * `appeal` (0..1) at move-in sets the rent; `width` scales headcount.
 */
export function generateTenant(
  kind: UnitKind,
  seed: string,
  appeal: number,
  width: number,
  archetypeId: string = DEFAULT_ARCHETYPE,
): Tenant | null {
  const subs = SUBSETS[kind];
  if (!subs) return null;
  const h = hashString(seed);
  const sub = subs[h % subs.length];
  // Offices & clinics are small full-day teams (4–6). Shops and restaurants
  // carry a larger roster split across shifts, so only a handful work at once
  // (see buildWorkers). Dwellings scale their occupancy with width.
  const employees =
    kind === "office" || kind === "medical"
      ? 4 + ((h >>> 5) % 3) // 4–6
      : kind === "store"
        ? 4 + ((h >>> 5) % 4) // 4–7 total across two shifts (~2–4 at once)
        : kind === "restaurant"
          ? 7 + ((h >>> 5) % 6) // 7–12 total across two shifts (~4–7 at once)
          : kind === "apartment"
            ? 1 + ((h >>> 5) % 2) // 1–2 residents
            : kind === "vending"
              ? 1 // just the brand's weekly route driver
              : Math.max(1, Math.round((HEADCOUNT[kind] ?? 2) * width * (0.7 + ((h >>> 5) % 50) / 100)));
  const days = sub.days ?? ALL_WEEK;
  const base = RENT_BASE[kind] ?? 1000;
  const dailyRent = Math.round(base * (0.5 + Math.max(0, Math.min(1, appeal))) * (0.9 + ((h >>> 9) % 25) / 100));
  const workers = buildWorkers(kind, sub.id, seed, archetypeId, employees, days, sub.open, sub.close);
  return {
    name: sub.name(hashString(`${seed}:name`)),
    subset: sub.id,
    trade: sub.label,
    openHour: sub.open,
    closeHour: sub.close,
    openDays: days,
    employees: workers.length, // includes any part-time day-off covers
    workers,
    appeal: Math.max(0, Math.min(1, appeal)),
    dailyRent,
    visitors: [],
  };
}

/** Whether the business operates on the given weekday (0=Mon … 6=Sun). */
export function tenantOpenDay(tenant: Tenant, dayIndex: number): boolean {
  return (tenant.openDays ?? ALL_WEEK).includes(dayIndex);
}

/** Whether a tenant is currently open for business (an operating day AND in hours). */
export function tenantOpen(tenant: Tenant, hourF: number, dayIndex: number): boolean {
  return tenantOpenDay(tenant, dayIndex) && hourF >= tenant.openHour && hourF < tenant.closeHour;
}

/**
 * Whether a tenant's lights are on: only on operating days, from an hour before
 * opening to an hour after closing.
 */
export function tenantLit(tenant: Tenant, hourF: number, dayIndex: number): boolean {
  return tenantOpenDay(tenant, dayIndex) && hourF >= tenant.openHour - 1 && hourF < tenant.closeHour + 1;
}

const DAY_ABBR = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Short label for a set of operating days, e.g. "Mon–Fri" or "Every day". */
export function daysLabel(openDays: number[]): string {
  const d = [...new Set(openDays)].sort((a, b) => a - b);
  if (d.length >= 7) return "Every day";
  if (d.length === 0) return "—";
  const contiguous = d.every((v, i) => i === 0 || v === d[i - 1] + 1);
  if (contiguous && d.length > 1) return `${DAY_ABBR[d[0]]}–${DAY_ABBR[d[d.length - 1]]}`;
  return d.map((i) => DAY_ABBR[i]).join(", ");
}

/** Format an hour (0..24) as e.g. "9a", "12p", "5p", "12a". */
export function hourLabel(h: number): string {
  const hh = ((h % 24) + 24) % 24;
  const am = hh < 12;
  const twelve = hh % 12 === 0 ? 12 : hh % 12;
  return `${twelve}${am ? "a" : "p"}`;
}

/** A worker's shift as e.g. "9a–5p" (or "—" for residents/guests with no shift). */
export function shiftLabel(w: Worker): string {
  if (w.dailySalary === 0) return "—";
  return `${hourLabel(w.startHour)}–${hourLabel(w.endHour)}`;
}

/** A worker's 1-hour lunch as e.g. "12p–1p" ("" if not applicable). */
export function lunchLabel(w: Worker): string {
  if (w.lunchHour < 0) return "";
  return `${hourLabel(w.lunchHour)}–${hourLabel(w.lunchHour + 1)}`;
}

/**
 * For a resident (no in-building job but a work schedule elsewhere): their
 * work days + hours, e.g. "Mon–Fri · 9a–5p". Empty for employees and guests.
 */
export function workScheduleLabel(w: Worker): string {
  if (w.dailySalary > 0 || w.days.length === 0) return "";
  return `${daysLabel(w.days)} · ${hourLabel(w.startHour)}–${hourLabel(w.endHour)}`;
}

/** What to call the headcount in the UI for this kind. */
export function headcountLabel(kind: UnitKind): string {
  if (kind === "apartment") return "Residents";
  if (kind === "hotel") return "Guests";
  return "Employees";
}
