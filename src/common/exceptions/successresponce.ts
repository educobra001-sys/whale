import { Request, Response } from "express"

export const successResponce = ({ res, message = "success", status = 200, data }:
    { res: Response; message?: string; status?: number; data?: any }) => {
    return res.status(status).json({ message, data })
}

// Controller shortcut: runs a service call and sends its result in the { message, data } envelope.
export const send = (fn: (req: any) => unknown, message = "success", status = 200) =>
    async (req: Request, res: Response) => {
        const data = await fn(req)
        successResponce({ res, message, status, data })
    }
