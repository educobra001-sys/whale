import { FEATURE_CATALOGUE } from "../../common/enum/feature.enum"
import { runAsPlatform } from "../../common/service/tenantContext"
import { repos } from "../../db/repository"

// Adds sections missing from the catalogue. Prices the owner already set are never overwritten.
export const seedFeatures = () => runAsPlatform(async () => {
    await Promise.all(FEATURE_CATALOGUE.map((feature, order) => repos.feature.updateone({
        filter: { key: feature.key },
        data: { $setOnInsert: { name: feature.name, description: feature.description, price: feature.price, order } },
        options: { upsert: true },
    })))
})
