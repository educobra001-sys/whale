import { Model, PopulateOptions } from "mongoose"

interface ReadOptions {
    filter?: any
    select?: string
    populate?: string | PopulateOptions | PopulateOptions[]
    sort?: any
    limit?: number
    skip?: number
    lean?: boolean
}

export class DatabaseReposatory<TRawDoc = any> {
    constructor(public model: Model<TRawDoc>) {}

    private shape(query: any, { select, populate, sort, limit, skip, lean = true }: ReadOptions) {
        if (select) query = query.select(select)
        if (populate) query = query.populate(populate)
        if (sort) query = query.sort(sort)
        if (skip) query = query.skip(skip)
        if (limit) query = query.limit(limit)
        if (lean) query = query.lean()
        // exec() starts the query now, while the caller's tenant scope is still current.
        return query.exec()
    }

    async create(data: any): Promise<any> {
        return await this.model.create(data)
    }

    insertMany(data: any[]) {
        return this.model.insertMany(data)
    }

    findall(options: ReadOptions = {}): Promise<any[]> {
        return this.shape(this.model.find(options.filter || {}), options)
    }

    findById({ id, ...options }: ReadOptions & { id: any }): Promise<any> {
        return this.shape(this.model.findOne({ _id: id }), options)
    }

    findone(options: ReadOptions & { filter: any }): Promise<any> {
        return this.shape(this.model.findOne(options.filter), options)
    }

    count(filter: any = {}) {
        return this.model.countDocuments(filter).exec()
    }

    exists(filter: any) {
        return this.model.exists(filter).exec()
    }

    distinct(field: string, filter: any = {}): Promise<any[]> {
        return this.model.distinct(field, filter).exec() as any
    }

    aggregate(pipeline: any[]): Promise<any[]> {
        return this.model.aggregate(pipeline).exec() as any
    }

    updateone({ filter, data, options }: { filter: any; data: any; options?: any }) {
        return this.model.updateOne(filter, data, options).exec()
    }

    updateMany({ filter, data }: { filter: any; data: any }) {
        return this.model.updateMany(filter, data).exec()
    }

    findOneAndUpdate({ filter, data, options, ...read }: ReadOptions & { filter: any; data: any; options?: any }): Promise<any> {
        return this.shape(this.model.findOneAndUpdate(filter, data, { returnDocument: "after", ...options }), read)
    }

    findByIdAndUpdate({ id, data, options, ...read }: ReadOptions & { id: any; data: any; options?: any }): Promise<any> {
        return this.findOneAndUpdate({ filter: { _id: id }, data, options, ...read })
    }

    deleteone({ filter }: { filter: any }) {
        return this.model.findOneAndDelete(filter).exec()
    }

    deleteMany({ filter }: { filter: any }) {
        return this.model.deleteMany(filter).exec()
    }

    deleteById(id: any) {
        return this.model.findOneAndDelete({ _id: id }).exec()
    }
}
