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

/** Shared street suffixes for generated addresses. */
const STREET_SUFFIXES = [
  "Street", "Avenue", "Ave", "Boulevard", "Blvd", "Road", "Lane", "Way",
  "Drive", "Plaza", "Row", "Terrace", "Quay", "Walk", "Court", "Square",
];

/**
 * Themed street names per archetype. Combined with a number and a suffix these
 * generate hundreds of region-appropriate street addresses per city, e.g.
 * "27 Orchard Ave", "1500 Lenin Blvd".
 */
const STREETS: Record<string, string[]> = {
  pacifica: ["Market", "Mission", "Sunset", "Castro", "Lombard", "Geary", "Pike", "Alaskan", "Robson", "Granville", "Hastings", "Cascade", "Redwood", "Pacific", "Cannery", "Ventura", "Sepulveda", "Wilshire", "Cahuenga", "Bayshore"],
  commonwealth: ["Baker", "Oxford", "Regent", "Fleet", "Downing", "Abbey", "Piccadilly", "Kingsway", "Portland", "Cheapside", "Whitehall", "Strand", "Threadneedle", "Cornhill", "Camden", "Deansgate", "Bishopsgate", "Holborn", "Mayfair", "Kensington"],
  europa: ["Charlemagne", "Rivoli", "Kurfürsten", "Champs", "Prinsen", "Ringstrasse", "Montenapo", "Schönbrunn", "Élysée", "Concorde", "Rhein", "Kaiser", "Bourse", "Meridian", "Alexander", "Damrak", "Vitruvius", "Concordia", "Europa", "Grunwald"],
  nordic: ["Storgata", "Drottning", "Kungs", "Vesterbro", "Nyhavn", "Bryggen", "Frost", "Aurora", "Fjord", "Vinter", "Nordlys", "Saga", "Odin", "Freya", "Bifrost", "Midgard", "Havn", "Skagen", "Thule", "Björk"],
  japan: ["Ginza", "Shibuya", "Shinjuku", "Akihabara", "Roppongi", "Chiyoda", "Nakano", "Harajuku", "Dotonbori", "Sakura", "Kabuki", "Mirai", "Sumida", "Meiji", "Ueno", "Asakusa", "Kanda", "Nihonbashi", "Aoyama", "Kaido"],
  "united-korea": ["Gangnam", "Itaewon", "Myeongdong", "Hongdae", "Sejong", "Jongno", "Insadong", "Namsan", "Dongdaemun", "Cheonggye", "Gwanghwamun", "Bukchon", "Yeouido", "Hanseong", "Daedong", "Mugunghwa", "Sinchon", "Apgujeong", "Samcheong", "Taegeuk"],
  oceania: ["George", "Pitt", "Collins", "Flinders", "Bourke", "Queen", "Swanston", "Elizabeth", "Bondi", "Darling", "Harbour", "Southbank", "Federation", "Kirribilli", "Parramatta", "Anzac", "Sturt", "Coral", "Reef", "Manly"],
  atlantea: ["Wall", "Broadway", "Madison", "Lexington", "Park", "Fifth", "Bay", "Beacon", "Boylston", "Yonge", "King", "Bloor", "Chestnut", "Liberty", "Hudson", "Canal", "Bowery", "Atlantic", "Congress", "Manhattan"],
  ussr: ["Lenin", "Gagarin", "October", "Pravda", "Kirov", "Prospekt", "Sovetskaya", "Kosmonaut", "Vosstaniya", "Marx", "Engels", "Kalinin", "Volgograd", "Krasnaya", "Mayakovsky", "Tverskaya", "Arbat", "Nevsky", "Zhukov", "Sputnik"],
  latam: ["Reforma", "Insurgentes", "Bolívar", "Corrientes", "Florida", "Paulista", "Copacabana", "Ipanema", "Libertador", "Independencia", "Amazonas", "Diagonal", "Constitución", "Revolución", "Malecón", "Chapultepec", "Condesa", "Palermo", "Providencia", "Sol"],
  gulf: ["Zayed", "Corniche", "Marina", "Khalifa", "Jumeirah", "Falcon", "Pearl", "Maktoum", "Deira", "Nakheel", "Dune", "Oasis", "Sabah", "Wasl", "Hamdan", "Rashid", "Dhow", "Souk", "Palm", "Meydan"],
  india: ["Marine", "Nehru", "Chandni", "Connaught", "Brigade", "Linking", "Bandra", "Juhu", "Rajpath", "Ashoka", "Lotus", "Colaba", "Cyberabad", "Indira", "Netaji", "Chowringhee", "Ballard", "Malabar", "Lodhi", "Peddar"],
  taiwan: ["Zhongshan", "Xinyi", "Zhongxiao", "Renai", "Dihua", "Ximen", "Guanqian", "Formosa", "Jade", "Keelung", "Bade", "Nanjing", "Fuxing", "Dunhua", "Songshan", "Beitou", "Tamsui", "Yangming", "Minsheng", "Heping"],
  china: ["Nanjing", "Wangfujing", "Changan", "Huaihai", "Bund", "Jianguo", "Fuxing", "Dragon", "Jade", "Pearl", "Tianfu", "Renmin", "Hongqiao", "Pudong", "Lujiazui", "Silk", "Vermilion", "Phoenix", "Harmony", "Yanan"],
  "straits-union": ["Orchard", "Raffles", "Bugis", "Marina", "Serangoon", "Geylang", "Bukit", "Merlion", "Sudirman", "Thamrin", "Sukhumvit", "Silom", "Sathorn", "Rizal", "Makati", "Nguyen", "Batavia", "Nusantara", "Selat", "Angkasa"],
  "african-union": ["Uhuru", "Kenyatta", "Nkrumah", "Mandela", "Sankofa", "Ubuntu", "Kilimanjaro", "Sahel", "Savannah", "Baobab", "Zambezi", "Nile", "Congo", "Azania", "Marina", "Kariba", "Serengeti", "Freedom", "Independence", "Adinkra"],
};

/**
 * Deterministic themed name for a plot. Mostly generates a region-appropriate
 * street address (number + street + suffix); roughly one plot in six keeps a
 * named tower from the archetype's property list. Pure and reproducible so the
 * simulation stays deterministic.
 */
export function propertyNameFor(archetypeId: string, index: number): string {
  const a = archetype(archetypeId);
  const h = ((index + 1) * 2654435761) >>> 0;
  if (h % 6 === 0) {
    return a.propertyNames[(h >>> 3) % a.propertyNames.length];
  }
  const streets = STREETS[a.id] ?? STREETS[DEFAULT_ARCHETYPE];
  const street = streets[(h >>> 4) % streets.length];
  const suffix = STREET_SUFFIXES[(h >>> 11) % STREET_SUFFIXES.length];
  const mag = (h >>> 16) % 3;
  const seed = h >>> 18;
  const num = mag === 0 ? 1 + (seed % 98) : mag === 1 ? 100 + (seed % 899) : 1000 + (seed % 3999);
  return `${num} ${street} ${suffix}`;
}

/** A random city name from the archetype's real + fictional pool (client-side). */
export function randomCityName(archetypeId: string, rnd: () => number = Math.random): string {
  const a = archetype(archetypeId);
  const pool = [...a.realCities, ...a.fictionalCities];
  return pool[Math.floor(rnd() * pool.length)] ?? a.name;
}

/** Representative latitude (°) for each archetype's region — the fallback. */
const ARCHETYPE_LATITUDE: Record<string, number> = {
  pacifica: 37,
  commonwealth: 52,
  europa: 48,
  nordic: 60,
  japan: 35,
  "united-korea": 37,
  oceania: -34,
  atlantea: 41,
  ussr: 56,
  latam: -20,
  gulf: 25,
  india: 20,
  taiwan: 24,
  china: 31,
  "straits-union": 5,
  "african-union": -5,
};

/**
 * Approximate real-world latitudes (°, north +) for the real cities in the
 * archetype pools, so a rolled city name can suggest a matching latitude.
 */
const CITY_LATITUDE: Record<string, number> = {
  // pacifica
  "los angeles": 34, "san francisco": 38, seattle: 48, vancouver: 49, "san diego": 33, portland: 46, oakland: 38,
  // commonwealth
  london: 52, manchester: 54, birmingham: 52, liverpool: 53, leeds: 54, glasgow: 56,
  // europa
  frankfurt: 50, paris: 49, rotterdam: 52, milan: 45, madrid: 40, warsaw: 52, vienna: 48,
  // nordic
  stockholm: 59, copenhagen: 56, oslo: 60, helsinki: 60, reykjavik: 64, malmö: 56, tallinn: 59,
  // japan
  tokyo: 36, osaka: 35, yokohama: 35, nagoya: 35, sapporo: 43, fukuoka: 34,
  // united-korea
  seoul: 38, busan: 35, incheon: 37, pyongyang: 39, daegu: 36,
  // oceania
  sydney: -34, melbourne: -38, brisbane: -27, auckland: -37, "gold coast": -28, perth: -32,
  // atlantea
  "new york": 41, toronto: 44, boston: 42, philadelphia: 40, montreal: 45, miami: 26, atlanta: 34,
  // ussr
  moscow: 56, kyiv: 50, leningrad: 60, minsk: 54, tashkent: 41, novosibirsk: 55,
  // latam
  "são paulo": -24, "sao paulo": -24, "mexico city": 19, "buenos aires": -35, "bogotá": 5, bogota: 5,
  santiago: -33, "panama city": 9, "rio de janeiro": -23,
  // gulf
  dubai: 25, "abu dhabi": 24, doha: 25, riyadh: 25, "kuwait city": 29, manama: 26, jeddah: 22,
  // india
  mumbai: 19, delhi: 29, bangalore: 13, hyderabad: 17, kolkata: 23, chennai: 13, pune: 19,
  // taiwan
  taipei: 25, kaohsiung: 23, taichung: 24, tainan: 23, hsinchu: 25,
  // china
  shanghai: 31, shenzhen: 23, guangzhou: 23, beijing: 40, chongqing: 30, "hong kong": 22, wuhan: 31,
  // straits-union
  singapore: 1, "kuala lumpur": 3, bangkok: 14, jakarta: -6, manila: 15, "ho chi minh city": 11, hanoi: 21,
  // african-union
  lagos: 6, johannesburg: -26, nairobi: -1, accra: 6, kinshasa: -4, luanda: -9, "cape town": -34,
};

/**
 * Suggested latitude for a city name: the real city's latitude if we know it,
 * otherwise the archetype's representative latitude. Used by the lobby's 🎲.
 */
export function suggestedLatitude(cityName: string, archetypeId: string): number {
  const key = cityName.trim().toLowerCase();
  if (key in CITY_LATITUDE) return CITY_LATITUDE[key];
  return ARCHETYPE_LATITUDE[archetypeId] ?? 40;
}
