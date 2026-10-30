import crypto from "node:crypto"
import mongoose, { Schema } from "mongoose"

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

export const newReferralId = () =>
    `EC-${Array.from(crypto.randomBytes(8), (byte) => ALPHABET[byte % ALPHABET.length]).join("")}`

// Everyone on the platform gets a marketing id. The registry maps an id back to its account.
const referralSchema = new mongoose.Schema({
    code: { type: String, required: true, unique: true },
    role: { type: String, required: true },
    account: { type: mongoose.Schema.Types.ObjectId, required: true },
}, { timestamps: true })
referralSchema.index({ account: 1 })
export const referralModel = mongoose.model("ReferralCode", referralSchema)

export const accountPlugin = (role: string) => (schema: Schema) => {
    schema.add({
        referralId: { type: String, unique: true, sparse: true },
        tokenVersion: { type: Number, default: 0 },
    })
    schema.pre("save", function (this: any) {
        if (!this.referralId) this.referralId = newReferralId()
        this.$locals.wasNew = this.isNew
    })
    schema.post("save", async function (this: any) {
        if (this.$locals.wasNew) await referralModel.create({ code: this.referralId, role, account: this._id })
    })
}
