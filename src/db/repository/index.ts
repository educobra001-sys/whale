import { referralModel } from "../plugin/account.plugin"
import assistantModel from "../model/assistant"
import centerModel from "../model/center"
import counterModel from "../model/counter"
import ownerModel from "../model/owner"
import parentModel from "../model/parent"
import studentModel from "../model/student"
import teacherModel from "../model/teacher"
import * as platform from "../model/platform"
import * as teaching from "../model/teaching"
import { DatabaseReposatory } from "./db.repo"

const repo = (model: any) => new DatabaseReposatory<any>(model)

export const repos = {
    owner: repo(ownerModel),
    teacher: repo(teacherModel),
    assistant: repo(assistantModel),
    center: repo(centerModel),
    student: repo(studentModel),
    parent: repo(parentModel),
    counter: repo(counterModel),
    referral: repo(referralModel),
    enrollment: repo(teaching.enrollmentModel),
    session: repo(teaching.sessionModel),
    attendance: repo(teaching.attendanceModel),
    transaction: repo(teaching.transactionModel),
    warning: repo(teaching.warningModel),
    pointsLog: repo(teaching.pointsLogModel),
    schedule: repo(teaching.scheduleModel),
    exam: repo(teaching.examModel),
    homework: repo(teaching.homeworkModel),
    submission: repo(teaching.submissionModel),
    lesson: repo(teaching.lessonModel),
    lessonGrant: repo(teaching.lessonGrantModel),
    lessonAnswer: repo(teaching.lessonAnswerModel),
    watch: repo(teaching.watchModel),
    booklet: repo(teaching.bookletModel),
    bookletOrder: repo(teaching.bookletOrderModel),
    rechargeCode: repo(teaching.rechargeCodeModel),
    topup: repo(teaching.topupModel),
    announcement: repo(teaching.announcementModel),
    followComment: repo(teaching.followCommentModel),
    expense: repo(teaching.expenseModel),
    monthlyActive: repo(teaching.monthlyActiveModel),
    template: repo(teaching.templateModel),
    messageBatch: repo(teaching.messageBatchModel),
    messageItem: repo(teaching.messageItemModel),
    centerLink: repo(platform.centerLinkModel),
    teacherLink: repo(platform.teacherLinkModel),
    feature: repo(platform.featureModel),
    pricingRule: repo(platform.pricingRuleModel),
    invoice: repo(platform.invoiceModel),
    affiliateEarning: repo(platform.affiliateEarningModel),
    setting: repo(platform.settingModel),
    telegramLink: repo(platform.telegramLinkModel),
    auditLog: repo(platform.auditLogModel),
}
