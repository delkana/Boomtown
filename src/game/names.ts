import { DEFAULT_ARCHETYPE } from "./archetypes";

/**
 * Person-name pools per city archetype (region). Each archetype has a pool of
 * given names and family names; a full name is one of each, so even a ~24-word
 * pool yields 500+ distinct names per region — far more than you'll ever see in
 * one building. Pure data + a deterministic picker (no Math.random) so a given
 * worker's name is a stable function of its seed. See generateTenant.
 */

interface NamePool {
  given: string[];
  family: string[];
}

const POOLS: Record<string, NamePool> = {
  pacifica: {
    given: ["Ava", "Liam", "Maya", "Ethan", "Sofia", "Noah", "Chloe", "Diego", "Harper", "Mason", "Zoe", "Kai", "Luna", "Owen", "Priya", "Jaden", "Nina", "Cole", "Elena", "Marcus", "Ruby", "Theo", "Aria", "Wyatt"],
    family: ["Bennett", "Torres", "Nguyen", "Parker", "Reyes", "Brooks", "Kim", "Foster", "Ramirez", "Hayes", "Chen", "Morgan", "Rivera", "Ellis", "Patel", "Sullivan", "Vargas", "Coleman", "Ortiz", "Hughes", "Tran", "Bishop", "Flores", "Grant"],
  },
  commonwealth: {
    given: ["Oliver", "Amelia", "Harry", "Charlotte", "George", "Emily", "Jack", "Sophie", "Thomas", "Grace", "Alfie", "Isla", "Freddie", "Poppy", "Arthur", "Evie", "Henry", "Daisy", "Oscar", "Florence", "Edward", "Millie", "Leo", "Ada"],
    family: ["Smith", "Taylor", "Brown", "Wilson", "Davies", "Evans", "Thomas", "Roberts", "Walker", "Wright", "Hughes", "Green", "Hall", "Clarke", "Baker", "Turner", "Hill", "Ward", "Cooper", "Morris", "Bennett", "Foster", "Barnes", "Shaw"],
  },
  europa: {
    given: ["Luca", "Sophie", "Matteo", "Emma", "Louis", "Marie", "Jonas", "Léa", "Giulia", "Finn", "Chiara", "Hugo", "Anouk", "Lorenzo", "Elin", "Sven", "Camille", "Niklas", "Isabelle", "Paolo", "Frida", "Bram", "Alessia", "Anton"],
    family: ["Müller", "Dubois", "Rossi", "De Vries", "Schneider", "Laurent", "Ferrari", "Bakker", "Fischer", "Moreau", "Romano", "Jansen", "Weber", "Bernard", "Bianchi", "Visser", "Meyer", "Girard", "Conti", "Novak", "Klein", "Simon", "Ricci", "Hoffmann"],
  },
  nordic: {
    given: ["Erik", "Freya", "Lars", "Astrid", "Magnus", "Ingrid", "Sven", "Sofia", "Bjørn", "Elin", "Nils", "Sanna", "Odin", "Maja", "Henrik", "Liv", "Kasper", "Nora", "Aksel", "Saga", "Emil", "Hanna", "Finn", "Alva"],
    family: ["Johansson", "Nielsen", "Hansen", "Andersen", "Lindqvist", "Berg", "Larsen", "Eriksson", "Karlsson", "Pedersen", "Nyström", "Dahl", "Holm", "Lindgren", "Sørensen", "Bergström", "Aalto", "Virtanen", "Sandberg", "Lund", "Moen", "Halla", "Fjeld", "Ek"],
  },
  japan: {
    given: ["Haruto", "Yui", "Sota", "Aoi", "Ren", "Hana", "Riku", "Mei", "Kenji", "Sakura", "Daiki", "Rin", "Takumi", "Yuki", "Sora", "Emi", "Kaito", "Nao", "Hiroshi", "Akira", "Yuna", "Ryo", "Kana", "Taro"],
    family: ["Sato", "Suzuki", "Takahashi", "Tanaka", "Watanabe", "Ito", "Yamamoto", "Nakamura", "Kobayashi", "Kato", "Yoshida", "Yamada", "Sasaki", "Matsumoto", "Inoue", "Kimura", "Hayashi", "Shimizu", "Mori", "Abe", "Ikeda", "Hashimoto", "Ishii", "Ogawa"],
  },
  "united-korea": {
    given: ["Min-jun", "Seo-yeon", "Ji-ho", "Ha-eun", "Do-yun", "Su-bin", "Jun-seo", "Ye-jin", "Eun-woo", "Ji-woo", "Hyun-woo", "Da-eun", "Seung-min", "So-yeon", "Tae-yang", "Na-rae", "Jae-won", "Yu-jin", "Sung-ho", "Mi-rae", "Kang-dae", "Hye-jin", "Joon-ho", "Ara"],
    family: ["Kim", "Lee", "Park", "Choi", "Jung", "Kang", "Cho", "Yoon", "Jang", "Lim", "Han", "Oh", "Seo", "Shin", "Kwon", "Hwang", "Ahn", "Song", "Ryu", "Hong", "Jeon", "Ko", "Moon", "Bae"],
  },
  oceania: {
    given: ["Jack", "Charlotte", "Oliver", "Ruby", "William", "Mia", "Noah", "Isla", "Kai", "Tui", "Hemi", "Aria", "Ethan", "Maia", "Cooper", "Ella", "Lachlan", "Amara", "Manaia", "Sienna", "Flynn", "Anahera", "Beau", "Willow"],
    family: ["Williams", "Wilson", "Nguyen", "Kelly", "Ryan", "Taylor", "Walker", "Ngata", "Cooper", "Chen", "Robinson", "Wiremu", "Mitchell", "Thompson", "Reweti", "Campbell", "Harrison", "Tui", "Bennett", "Fraser", "Nixon", "Katoa", "Doyle", "Marsh"],
  },
  atlantea: {
    given: ["Sophia", "Jayden", "Isabella", "Malik", "Olivia", "Xavier", "Emma", "Andre", "Ava", "Elijah", "Mia", "Jamal", "Chloe", "Marcus", "Layla", "Devin", "Nora", "Isaiah", "Grace", "Damien", "Aaliyah", "Tobias", "Simone", "Reggie"],
    family: ["Johnson", "Williams", "Jones", "Brown", "Davis", "Miller", "Robinson", "Jackson", "Carter", "Mitchell", "Perez", "Bennett", "Russell", "Coleman", "Foster", "Bryant", "Rivera", "Hayes", "Powell", "Ross", "Simmons", "Dixon", "Freeman", "Wallace"],
  },
  ussr: {
    given: ["Dmitri", "Anya", "Sergei", "Katya", "Ivan", "Olga", "Nikolai", "Svetlana", "Alexei", "Irina", "Boris", "Natasha", "Yuri", "Ludmila", "Mikhail", "Vera", "Pavel", "Galina", "Andrei", "Tatiana", "Viktor", "Nadia", "Grigori", "Elena"],
    family: ["Ivanov", "Petrov", "Sidorov", "Volkov", "Sokolov", "Popov", "Kuznetsov", "Morozov", "Novikov", "Fedorov", "Kozlov", "Lebedev", "Orlov", "Makarov", "Nikitin", "Zaitsev", "Solovyov", "Vasiliev", "Egorov", "Pavlov", "Semyonov", "Golubev", "Titov", "Frolov"],
  },
  latam: {
    given: ["Mateo", "Valentina", "Santiago", "Camila", "Sebastián", "Isabela", "Diego", "Lucía", "Nicolás", "Sofía", "Andrés", "Mariana", "Tomás", "Gabriela", "Emiliano", "Daniela", "Joaquín", "Renata", "Felipe", "Antonella", "Bruno", "Paula", "Rafael", "Ximena"],
    family: ["García", "Rodríguez", "Martínez", "López", "González", "Hernández", "Pérez", "Sánchez", "Ramírez", "Torres", "Flores", "Rivera", "Gómez", "Díaz", "Cruz", "Morales", "Reyes", "Ortiz", "Castillo", "Silva", "Vargas", "Mendoza", "Romero", "Herrera"],
  },
  gulf: {
    given: ["Omar", "Layla", "Yusuf", "Fatima", "Ali", "Aisha", "Khalid", "Mariam", "Hassan", "Noor", "Ahmed", "Sara", "Ibrahim", "Huda", "Tariq", "Amira", "Zaid", "Salma", "Rashid", "Yasmin", "Faisal", "Dana", "Nasser", "Reem"],
    family: ["Al-Farsi", "Al-Sayed", "Khan", "Al-Rashid", "Hassan", "Al-Maktoum", "Nasser", "Al-Amir", "Saleh", "Al-Najjar", "Haddad", "Al-Zahrani", "Mansour", "Al-Qasimi", "Karim", "Al-Hashimi", "Darwish", "Al-Sabah", "Rahman", "Al-Ghamdi", "Nabil", "Al-Mansoori", "Fahad", "Al-Habib"],
  },
  india: {
    given: ["Aarav", "Priya", "Rohan", "Ananya", "Arjun", "Diya", "Vikram", "Meera", "Karan", "Isha", "Aditya", "Neha", "Rahul", "Pooja", "Sanjay", "Riya", "Vivek", "Kavya", "Nikhil", "Anjali", "Dev", "Sneha", "Rajesh", "Tara"],
    family: ["Sharma", "Patel", "Singh", "Kumar", "Gupta", "Rao", "Reddy", "Iyer", "Nair", "Mehta", "Desai", "Chopra", "Malhotra", "Kapoor", "Banerjee", "Joshi", "Menon", "Verma", "Bose", "Pillai", "Shah", "Chatterjee", "Naidu", "Gowda"],
  },
  taiwan: {
    given: ["Wei", "Mei-ling", "Jian", "Yu-ting", "Hao", "Xin-yi", "Cheng", "Shu-fen", "Kai", "Li-hua", "Jun", "Ya-wen", "Ming", "Pei-shan", "Chih", "Hui-chen", "Zhi", "Wan-ju", "Sheng", "Ching", "Bo", "Yi-chen", "Tao", "Fang"],
    family: ["Chen", "Lin", "Huang", "Wang", "Chang", "Li", "Wu", "Liu", "Tsai", "Yang", "Hsu", "Cheng", "Kuo", "Chou", "Chiang", "Hsieh", "Lai", "Chan", "Weng", "Ho", "Su", "Tseng", "Yeh", "Chu"],
  },
  china: {
    given: ["Wei", "Fang", "Jing", "Hao", "Li", "Ming", "Yan", "Lei", "Xia", "Jun", "Hui", "Feng", "Ling", "Bin", "Na", "Tao", "Yun", "Peng", "Mei", "Gang", "Xin", "Rong", "Chen", "Juan"],
    family: ["Wang", "Li", "Zhang", "Liu", "Chen", "Yang", "Zhao", "Huang", "Zhou", "Wu", "Xu", "Sun", "Zhu", "Ma", "Hu", "Guo", "Lin", "He", "Gao", "Luo", "Zheng", "Liang", "Xie", "Tang"],
  },
  "straits-union": {
    given: ["Wei Jie", "Siti", "Minh", "Nurul", "Arif", "Mei Ling", "Anh", "Putri", "Kiat", "Ratana", "Bao", "Intan", "Hafiz", "Suki", "Duc", "Ayu", "Somchai", "Lan", "Faizal", "Dewi", "Thanh", "Ravi", "Chai", "Ningsih"],
    family: ["Tan", "Lim", "Wong", "Nguyen", "Rahman", "Kaur", "Tran", "Santos", "Lee", "Ismail", "Pham", "Wijaya", "Ong", "Abdullah", "Le", "Reyes", "Goh", "Suharto", "Chua", "Hassan", "Bui", "Ali", "Ng", "Prasetyo"],
  },
  "african-union": {
    given: ["Kwame", "Amara", "Chidi", "Zola", "Kofi", "Nia", "Tunde", "Ayanda", "Femi", "Thandiwe", "Sekou", "Amina", "Obi", "Zuri", "Jabari", "Fatou", "Chinua", "Naledi", "Musa", "Aisha", "Kagiso", "Ade", "Simba", "Lerato"],
    family: ["Okafor", "Mensah", "Dlamini", "Adebayo", "Nkosi", "Mwangi", "Abubakar", "Osei", "Mabaso", "Diallo", "Achebe", "Kamau", "Balogun", "Zuma", "Owusu", "Njoroge", "Chukwu", "Molefe", "Sowande", "Mubarak", "Eze", "Asante", "Ndlovu", "Traoré"],
  },
};

/**
 * A deterministic region-appropriate full name from a hash. Uses the city
 * archetype's pool (falling back to the default region if unknown).
 */
export function personName(archetypeId: string, h: number): string {
  const pool = POOLS[archetypeId] ?? POOLS[DEFAULT_ARCHETYPE];
  const given = pool.given[(h >>> 0) % pool.given.length];
  const family = pool.family[(h >>> 7) % pool.family.length];
  return `${given} ${family}`;
}
