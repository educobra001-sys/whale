import { Schema, Types } from "mongoose"
import { currentTenant } from "../../common/service/tenantContext"

const QUERY_HOOKS = [
    "find", "findOne", "countDocuments", "distinct", "updateOne", "updateMany",
    "findOneAndUpdate", "findOneAndDelete", "findOneAndReplace", "deleteOne", "deleteMany", "replaceOne",
]

// Returns the teacher id to force, or null for platform code. Throws when there is no scope at all:
// a forgotten scope must fail loudly instead of reading another teacher's data.
const requireScope = (modelName: string) => {
    const tenant = currentTenant()
    if (tenant?.platform) return null
    if (tenant?.teacherId) return new Types.ObjectId(tenant.teacherId)
    throw new Error(`Unscoped access to teacher data on ${modelName}`)
}

export const tenantPlugin = (schema: Schema) => {
    schema.pre(QUERY_HOOKS as any, function (this: any) {
        const teacher = requireScope(this.model.modelName)
        if (teacher) this.setQuery({ ...this.getFilter(), teacher })
    })

    schema.pre("aggregate", function (this: any) {
        const teacher = requireScope(this._model?.modelName ?? "aggregate")
        if (teacher) this.pipeline().unshift({ $match: { teacher } })
    })

    schema.pre("validate", function (this: any) {
        const teacher = requireScope(this.constructor.modelName)
        if (!teacher) return
        if (this.teacher && String(this.teacher) !== String(teacher)) throw new Error("Cross-teacher write refused")
        this.teacher = teacher
    })

    schema.pre("insertMany", function (this: any, ...args: any[]) {
        const teacher = requireScope(this.modelName)
        if (!teacher) return
        const docs = args.find((arg) => Array.isArray(arg) || (arg && typeof arg === "object" && !arg.session)) ?? []
        for (const doc of [].concat(docs)) {
            const row = doc as any
            if (row.teacher && String(row.teacher) !== String(teacher)) throw new Error("Cross-teacher write refused")
            row.teacher = teacher
        }
    })

    schema.pre("bulkWrite" as any, function (this: any) {
        if (requireScope(this.modelName)) throw new Error("bulkWrite is not available inside a teacher scope")
    })
}
