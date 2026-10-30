// Every section of the teacher platform that can be sold. The catalogue is seeded from here;
// the owner then sets the real prices from the admin panel.
export const FEATURE_CATALOGUE = [
    { key: "students", name: "Students", description: "Class list, profiles, import, QR cards", price: 3 },
    { key: "sessions", name: "Sessions & reports", description: "Sessions, reports, closings, assistants check-in", price: 3 },
    { key: "scan", name: "Live scan", description: "Attendance, homework and door scanning", price: 2 },
    { key: "schedule", name: "Weekly schedule", description: "Groups and start-from-schedule", price: 1 },
    { key: "lessons", name: "Video lessons", description: "Parts, pop-up questions, access rules", price: 3 },
    { key: "homework", name: "Online homework", description: "Assign, collect and correct online", price: 1 },
    { key: "exams", name: "Exams", description: "Exams and score sheets", price: 1 },
    { key: "booklets", name: "Booklets", description: "Catalogue, orders and deliveries", price: 1 },
    { key: "follow_up", name: "Follow-up", description: "Call lists, notes and assignment", price: 1 },
    { key: "announcements", name: "Announcements", description: "Ads inside the teacher's course", price: 1 },
    { key: "leaderboard", name: "Leaderboard", description: "Points and ranking", price: 0.5 },
    { key: "wallet", name: "Wallet", description: "Recharge codes and transfer top-ups", price: 2 },
    { key: "finance", name: "Finance", description: "Income, expenses, salaries", price: 1 },
    { key: "assistants", name: "Assistants", description: "Team accounts and permissions", price: 1 },
    { key: "centers", name: "Learning centers", description: "Link with centers", price: 0.5 },
    { key: "telegram", name: "Telegram messages", description: "Attendance and absence by bot", price: 1 },
    { key: "whatsapp", name: "WhatsApp messages", description: "Attendance and absence by WhatsApp", price: 2 },
] as const

export const ALL_FEATURE_KEYS: string[] = FEATURE_CATALOGUE.map((item) => item.key)
