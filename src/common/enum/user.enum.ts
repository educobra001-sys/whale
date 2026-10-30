export enum roleEnum {
    Owner = "owner",
    Teacher = "teacher",
    Assistant = "assistant",
    Center = "center",
    Student = "student",
    Parent = "parent",
}

export const genders = ["male", "female"] as const
export const grades = ["0", "1", "2"] as const
export const studyLanguages = ["0", "1"] as const
export const teachingLanguages = ["Arabic", "English"] as const
export const subjects = ["Math", "Physics", "English", "Science", "Biology", "Chemistry", "Arabic"] as const

export const teacherStatuses = ["pending_email", "pending_approval", "active", "rejected", "suspended"] as const
export const centerStatuses = ["pending_approval", "active", "rejected", "suspended"] as const
