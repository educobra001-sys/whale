import mongoose from "mongoose"
import { env } from "../config/env.service"

mongoose.set("transactionAsyncLocalStorage", true)
mongoose.set("strictQuery", true)

export const dbconnection = async () => {
    await mongoose.connect(env.dataBase_url, {
        dbName: env.db_name,
        maxPoolSize: 50,
        minPoolSize: 5,
        serverSelectionTimeoutMS: 8000,
        autoIndex: true,
    })
    console.log("database connected")
}

// Runs fn in one multi-document transaction; every query inside it joins automatically.
export const withTransaction = <T>(fn: () => Promise<T>): Promise<T> =>
    mongoose.connection.transaction(fn, { writeConcern: { w: "majority" } }) as Promise<T>
