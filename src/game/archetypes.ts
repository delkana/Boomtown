/**
 * City archetypes — pure content data (no DOM). Shared by the server (to name
 * plots and seed demo cities) and the client (lobby picker, random names).
 *
 * Each archetype carries:
 *  - `blurb`          a short cyberpunk background for the region,
 *  - `realCities`     real cities in that region famous for highrises/skyscrapers,
 *  - `fictionalCities`invented but region-appropriate names,
 *  - `propertyNames`  themed building / megacorp names for plots and owners.
 *
 * `realCities` + `fictionalCities` form the random city-name pool. Property
 * names are assigned to plots deterministically (see `propertyNameFor`) so the
 * pure simulation stays reproducible.
 */
export interface Archetype {
  id: string;
  name: string;
  blurb: string;
  /** Primary theme/accent color (matches the flag). */
  accent: string;
  realCities: string[];
  fictionalCities: string[];
  propertyNames: string[];
}

export const ARCHETYPES: Archetype[] = [
  {
    id: "pacifica",
    name: "Pacifica",
    accent: "#e8743b",
    blurb:
      "Sun-bleached megatowers crowd the fault lines from Vancouver to San Diego — venture arcologies and surf-punk sprawl under a smog-orange sky.",
    realCities: ["Los Angeles", "San Francisco", "Seattle", "Vancouver", "San Diego", "Portland", "Oakland"],
    fictionalCities: ["New Angeles", "Pacifica", "Bayside", "Silicon Reach", "Westport", "Sunset City", "Goldengate"],
    propertyNames: [
      "Redwood Spire", "Pacific Crest Tower", "Bayview Arcology", "Golden Gate Holdings",
      "Cascade Systems", "Sunset Vertical", "Neon Bay Corp", "Silicon Heights",
      "Fog Harbor Trust", "Westwind Plaza", "Tidepool Group", "Sequoia Prime",
      "Marina Vertical", "Coastline Dynamics", "Emerald Sound Tower", "Sundown Holdings",
    ],
  },
  {
    id: "commonwealth",
    name: "Commonwealth",
    accent: "#39c2ff",
    blurb:
      "Rain-slick spires rise over the Thames sprawl — old crowns and new megacorps trade the skyline of a neon Commonwealth.",
    realCities: ["London", "Manchester", "Birmingham", "Liverpool", "Leeds", "Glasgow"],
    fictionalCities: ["New Albion", "Kingsreach", "Thameside", "Britannia", "Greyharbour", "Camden Vertical"],
    propertyNames: [
      "Thameside Chambers", "Albion Works", "Kingsreach Tower", "Canary Vertical",
      "Britannia Holdings", "Greyfriars Estate", "Whitehall Systems", "Regent Spire",
      "Ironmonger Trust", "Crownpoint Plaza", "Blackwall Group", "St. Pauls Prime",
      "Mersey Dynamics", "Highgate Vertical", "Sovereign Wharf", "Baronsgate Holdings",
    ],
  },
  {
    id: "europa",
    name: "Europa",
    accent: "#f4c94b",
    blurb:
      "From La Défense to the Rhine, glass towers and old-world stone fuse into the neon patchwork of a federated Europa.",
    realCities: ["Frankfurt", "Paris", "Rotterdam", "Milan", "Madrid", "Warsaw", "Vienna"],
    fictionalCities: ["Neustadt", "Europa Centrum", "Rheinstadt", "Nouvelle Lumière", "Ostmark", "Meridian City"],
    propertyNames: [
      "Rheinturm", "Lumière Tower", "Centrum Holdings", "Neustadt Werke",
      "Meridian EU", "Bourse Vertical", "Ostmark Group", "Grande Arche Trust",
      "Habsburg Prime", "Vitreous Plaza", "Rembrandt Systems", "Pan-Europa Dynamics",
      "Alpine Spire", "Concorde Holdings", "Charlemagne Tower", "Vistula Vertical",
    ],
  },
  {
    id: "nordic",
    name: "Nordic Federation",
    accent: "#6ff0e0",
    blurb:
      "Under aurora and endless winter dark, low-carbon arcologies glow across the fjords of the unified Nordic Federation.",
    realCities: ["Stockholm", "Copenhagen", "Oslo", "Helsinki", "Reykjavik", "Malmö", "Tallinn"],
    fictionalCities: ["Vinterhavn", "Svarthavn", "Nordlys", "Frosthjem", "Auroraborg", "Nyfjord"],
    propertyNames: [
      "Vinterhavn Spire", "Nordlys Holdings", "Frost Vertical", "Aurora Werk",
      "Fjordgate", "Midnight Sun Corp", "Sölvberg Trust", "Ísborg Systems",
      "Thule Dynamics", "Skagen Prime", "Glacier Plaza", "Björk Vertical",
      "Runestone Group", "Polaris Tower", "Havfrue Holdings", "Tundra Works",
    ],
  },
  {
    id: "japan",
    name: "Japan",
    accent: "#ff2b4e",
    blurb:
      "Holograms drown the rain over Neo-Tokyo — zaibatsu towers stack to the clouds above the endless sprawl.",
    realCities: ["Tokyo", "Osaka", "Yokohama", "Nagoya", "Sapporo", "Fukuoka"],
    fictionalCities: ["Neo-Tokyo", "Neo-Kyoto", "Chiba City", "Shinjuku Prime", "Mirai", "Zaibatsu Bay"],
    propertyNames: [
      "Mirai Tower", "Zaibatsu Prime", "Shinkai Systems", "Sakura Vertical",
      "Kaiju Holdings", "Neon Shrine", "Genzai Corp", "Tsuki Dynamics",
      "Akira Works", "Kagayaki Plaza", "Ronin Trust", "Hikari Tower",
      "Oni Group", "Sora Vertical", "Kinzoku Holdings", "Yamato Prime",
    ],
  },
  {
    id: "united-korea",
    name: "United Korea",
    accent: "#2b6fe2",
    blurb:
      "One peninsula, one skyline: from the old DMZ scar to Neo-Seoul, chaebol spires and pop-neon light the reunified night.",
    realCities: ["Seoul", "Busan", "Incheon", "Pyongyang", "Daegu"],
    fictionalCities: ["Neo-Seoul", "Hanseong", "Unity City", "Daedong Prime", "Hallyu Heights", "Baekje"],
    propertyNames: [
      "Hanseong Tower", "Daedong Holdings", "Hallyu Vertical", "Unity Spire",
      "Han River Systems", "Gangnam Prime", "Baekdu Group", "Silla Dynamics",
      "Mugunghwa Plaza", "Cheongwa Trust", "Sejong Tower", "Dongdaemun Vertical",
      "Taeguk Holdings", "Nam Works", "Joseon Prime", "Sunrise Combine",
    ],
  },
  {
    id: "oceania",
    name: "Oceania",
    accent: "#ffce4a",
    blurb:
      "Beneath the Southern Cross, harbour arcologies and red-dust boomtowns rise from Sydney to Auckland.",
    realCities: ["Sydney", "Melbourne", "Brisbane", "Auckland", "Gold Coast", "Perth"],
    fictionalCities: ["Southern Cross", "Newhaven", "Coral City", "Antipode", "Harbour Prime", "Reefside"],
    propertyNames: [
      "Southern Cross Tower", "Coral Holdings", "Harbour Vertical", "Outback Systems",
      "Antipode Werks", "Reef Corp", "Bondi Prime", "Kookaburra Trust",
      "Red Centre Dynamics", "Tasman Plaza", "Billabong Group", "Aotearoa Tower",
      "Sunburnt Holdings", "Longshore Vertical", "Boomerang Prime", "Dreamtime Works",
    ],
  },
  {
    id: "atlantea",
    name: "Atlantea",
    accent: "#d23b52",
    blurb:
      "From the Hudson canyons to Miami's flooded avenues, the old empire towers of Atlantea claw at a bruised Atlantic sky.",
    realCities: ["New York", "Toronto", "Boston", "Philadelphia", "Montreal", "Miami", "Atlanta"],
    fictionalCities: ["New Atlantis", "Empire Heights", "Liberty City", "New Boston", "Beacon", "Harbor Point"],
    propertyNames: [
      "Empire Spire", "Liberty Holdings", "Atlantic Vertical", "Hudson Works",
      "Gotham Systems", "Beacon Tower", "Freedom Trust", "Ironside Prime",
      "Brownstone Group", "Meridian Plaza", "Copley Dynamics", "Bay State Vertical",
      "Skyline Holdings", "Riverside Prime", "Old Harbor Tower", "Colonial Combine",
    ],
  },
  {
    id: "ussr",
    name: "USSR",
    accent: "#f4c94b",
    blurb:
      "The Union endures: brutalist megablocks and chrome red stars tower over Kosmograd in an eternal Five-Year Plan.",
    realCities: ["Moscow", "Kyiv", "Leningrad", "Minsk", "Tashkent", "Novosibirsk"],
    fictionalCities: ["Kosmograd", "Red Meridian", "Novgorad", "Staltsov Prime", "Krasnoyar", "Sputnik City"],
    propertyNames: [
      "Kosmograd Tower", "Red October Combine", "Sputnik Vertical", "People's Spire",
      "Vostok Systems", "Kremlin Works", "Star of Labor", "Molot Holdings",
      "Gagarin Prime", "Proletariat Plaza", "Iron Curtain Trust", "Soyuz Dynamics",
      "Pravda Tower", "Kollektiv Vertical", "Baikal Group", "Sickle & Spire",
    ],
  },
  {
    id: "latam",
    name: "LATAM",
    accent: "#1f8a4c",
    blurb:
      "From São Paulo's endless towers to the neon favelas of El Dorado, the unified LATAM bloc burns bright and unequal.",
    realCities: ["São Paulo", "Mexico City", "Buenos Aires", "Bogotá", "Santiago", "Panama City", "Rio de Janeiro"],
    fictionalCities: ["Nueva Aurora", "Ciudad Sur", "Solaris", "Panamérica", "Verdeciudad", "El Dorado"],
    propertyNames: [
      "El Dorado Tower", "Solaris Holdings", "Panamérica Vertical", "Aurora Sur",
      "Selva Systems", "Cumbre Werks", "Sol de Mayo Trust", "Cóndor Prime",
      "Amazonía Dynamics", "Estrella Plaza", "Libertador Group", "Costa Verde Tower",
      "Jaguar Holdings", "Mariposa Vertical", "Nueva Cumbre Prime", "Pampas Combine",
    ],
  },
  {
    id: "gulf",
    name: "Gulf Emirates",
    accent: "#0b7a3b",
    blurb:
      "Solar spires pierce the heat-haze over the Gulf — desalinated marinas and gold-glass burj crown the Emirates' endless boom.",
    realCities: ["Dubai", "Abu Dhabi", "Doha", "Riyadh", "Kuwait City", "Manama", "Jeddah"],
    fictionalCities: ["New Sabah", "Al-Nahda", "Zenith", "Marina Prime", "Falcon City", "Golden Dune"],
    propertyNames: [
      "Zenith Tower", "Al-Nahda Holdings", "Falcon Vertical", "Dune Prime",
      "Pearl Systems", "Mirage Werks", "Burj Sabah", "Oryx Trust",
      "Sandglass Dynamics", "Marina Plaza", "Desert Rose Group", "Solar Crescent Tower",
      "Gold Souk Holdings", "Khaleej Vertical", "Sirocco Prime", "Nakheel Combine",
    ],
  },
  {
    id: "india",
    name: "India",
    accent: "#e8863b",
    blurb:
      "Monsoon neon floods the megacity — from Mumbai's vertical slums to Indraprastha's data-spires, a billion lights never sleep.",
    realCities: ["Mumbai", "Delhi", "Bangalore", "Hyderabad", "Kolkata", "Chennai", "Pune"],
    fictionalCities: ["Navi Bharat", "Indraprastha", "Chandra City", "Monsoon Prime", "Ashoka Heights", "Meghnagar"],
    propertyNames: [
      "Indraprastha Tower", "Ashoka Holdings", "Monsoon Vertical", "Chandra Systems",
      "Lotus Werks", "Bharat Prime", "Garuda Trust", "Vayu Dynamics",
      "Sitara Plaza", "Rajpath Group", "Deccan Vertical", "Peacock Tower",
      "Mumbai Prime", "Ganga Holdings", "Neon Bazaar Combine", "Himalaya Spire",
    ],
  },
  {
    id: "taiwan",
    name: "Taiwan",
    accent: "#1b3a8f",
    blurb:
      "The island of chips: Formosa's fab-towers and night-market sprawl glow across the strait under typhoon skies.",
    realCities: ["Taipei", "Kaohsiung", "Taichung", "Tainan", "Hsinchu"],
    fictionalCities: ["Neo-Taipei", "Formosa Prime", "Jade City", "Ilha Heights", "Silicon Strait", "Bao'an"],
    propertyNames: [
      "Formosa Tower", "Jade Holdings", "Silicon Strait Systems", "Taipei Prime",
      "Typhoon Vertical", "Semiconductor Werks", "Lantern Trust", "Hokkien Dynamics",
      "Night Market Group", "Wafer Plaza", "Strait Star Tower", "Oolong Vertical",
      "Ilha Holdings", "Beitou Prime", "Formosan Combine", "Jade Emperor Spire",
    ],
  },
  {
    id: "china",
    name: "China",
    accent: "#d21f2b",
    blurb:
      "Ten thousand towers: from Shanghai's Pudong canyon to Chongqing's fog-drowned stacks, the Middle Kingdom scrapes heaven.",
    realCities: ["Shanghai", "Shenzhen", "Guangzhou", "Beijing", "Chongqing", "Hong Kong", "Wuhan"],
    fictionalCities: ["New Shanghai", "Dragon Gate", "Zhong City", "Harmony Prime", "Red Phoenix", "Tianxia"],
    propertyNames: [
      "Dragon Gate Tower", "Tianxia Holdings", "Red Phoenix Vertical", "Harmony Systems",
      "Pearl River Werks", "Jade Emperor Prime", "Golden Dragon Trust", "Pudong Dynamics",
      "Lotus Throne Plaza", "Great Wall Group", "Silk Road Vertical", "Nine Dragons Tower",
      "Middle Kingdom Holdings", "Cloud Palace Prime", "Vermilion Combine", "Sky Lantern Spire",
    ],
  },
  {
    id: "straits-union",
    name: "Straits Union",
    accent: "#ee2536",
    blurb:
      "Monsoon heat and hyper-dense towers: from Singapore's garden-arcologies to Jakarta's flooded stacks, the Straits Union is peak tropical neon.",
    realCities: ["Singapore", "Kuala Lumpur", "Bangkok", "Jakarta", "Manila", "Ho Chi Minh City", "Hanoi"],
    fictionalCities: ["Nusantara", "Neo-Singapura", "Straitsport", "Merlion City", "Selatgrad", "Monsoon Bay"],
    propertyNames: [
      "Marina Spire", "Merlion Holdings", "Nusantara Prime", "Straits Vertical",
      "Orchard Systems", "Batavia Werks", "Monsoon Tower", "Raffles Group",
      "Selat Dynamics", "Garuda Vertical", "Peranakan Plaza", "Angkasa Tower",
      "Naga Holdings", "Bumi Combine", "Kampung Stack", "Sunda Prime",
    ],
  },
  {
    id: "african-union",
    name: "African Union",
    accent: "#0e7a4a",
    blurb:
      "From Lagos's mega-lagoon towers to the solar spires of New Azania, the unified continent rises on its own terms.",
    realCities: ["Lagos", "Johannesburg", "Nairobi", "Accra", "Kinshasa", "Luanda", "Cape Town"],
    fictionalCities: ["New Azania", "Sankofa", "Ubuntu City", "Savannah Prime", "Nairobi Heights", "Kilimanjaro City"],
    propertyNames: [
      "Sankofa Tower", "Ubuntu Holdings", "Savannah Vertical", "Kilimanjaro Systems",
      "Baobab Werks", "Azania Prime", "Great Zimbabwe Corp", "Sahel Dynamics",
      "Serengeti Plaza", "Nile Star Group", "Lagos Lagoon Vertical", "Sun Empire Tower",
      "Timbuktu Holdings", "Zulu Prime", "Adinkra Combine", "Solar Savanna Spire",
    ],
  },
];

export const DEFAULT_ARCHETYPE = ARCHETYPES[0].id;

const BY_ID: Record<string, Archetype> = Object.fromEntries(
  ARCHETYPES.map((a) => [a.id, a]),
);

export function archetype(id: string): Archetype {
  return BY_ID[id] ?? ARCHETYPES[0];
}

export function isArchetype(id: string): boolean {
  return id in BY_ID;
}

/**
 * Deterministic themed name for a plot. Cycles through the pool and appends an
 * ordinal when it wraps, so names stay stable and mostly unique.
 */
export function propertyNameFor(archetypeId: string, index: number): string {
  const pool = archetype(archetypeId).propertyNames;
  const base = pool[index % pool.length];
  const cycle = Math.floor(index / pool.length);
  return cycle > 0 ? `${base} ${cycle + 1}` : base;
}

/** A random city name from the archetype's real + fictional pool (client-side). */
export function randomCityName(archetypeId: string, rnd: () => number = Math.random): string {
  const a = archetype(archetypeId);
  const pool = [...a.realCities, ...a.fictionalCities];
  return pool[Math.floor(rnd() * pool.length)] ?? a.name;
}
