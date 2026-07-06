import { hashString } from "./hash";
import type { Tenant, UnitKind } from "./types";

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
};

/** People (employees or residents) per width tile, per kind. */
const HEADCOUNT: Partial<Record<UnitKind, number>> = {
  office: 4, medical: 3, store: 2, restaurant: 3, apartment: 2, hotel: 3,
};

/** Base daily rent per kind (scaled by appeal + a little variance). */
const RENT_BASE: Partial<Record<UnitKind, number>> = {
  office: 1400, medical: 1800, store: 1200, restaurant: 1600, apartment: 1000, hotel: 620,
};

/** Whether a kind can hold a tenant at all. */
export function hasTrades(kind: UnitKind): boolean {
  return kind in SUBSETS;
}

/**
 * Deterministically generate the tenant for a room from its stable `seed`
 * (plot + unit id). Picks an appropriate subset, then a name from that subset's
 * pool. `appeal` (0..1) at move-in sets the rent; `width` scales headcount.
 */
export function generateTenant(kind: UnitKind, seed: string, appeal: number, width: number): Tenant | null {
  const subs = SUBSETS[kind];
  if (!subs) return null;
  const h = hashString(seed);
  const sub = subs[h % subs.length];
  const per = HEADCOUNT[kind] ?? 2;
  const employees = Math.max(1, Math.round(per * width * (0.7 + ((h >>> 5) % 50) / 100)));
  const base = RENT_BASE[kind] ?? 1000;
  const dailyRent = Math.round(base * (0.5 + Math.max(0, Math.min(1, appeal))) * (0.9 + ((h >>> 9) % 25) / 100));
  return {
    name: sub.name(hashString(`${seed}:name`)),
    subset: sub.id,
    trade: sub.label,
    openHour: sub.open,
    closeHour: sub.close,
    openDays: sub.days ?? ALL_WEEK,
    employees,
    dailyRent,
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

/** What to call the headcount in the UI for this kind. */
export function headcountLabel(kind: UnitKind): string {
  if (kind === "apartment") return "Residents";
  if (kind === "hotel") return "Guests";
  return "Employees";
}
