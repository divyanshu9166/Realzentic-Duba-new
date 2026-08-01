import { roundMoney } from './money'

/**
 * Estimate UAE end-of-service benefit (EOSB) on basic salary only.
 * The calculation follows the standard 21-days-per-year rate for the first
 * five completed years, then 30 days per year, capped at two years of basic
 * salary. It is a calculation aid; HR must validate the employee's contract,
 * visa status, and any applicable savings scheme before settlement.
 */
export function calculateEosb(basicMonthlySalary: number, completedYears: number): number {
  const monthly = Number.isFinite(basicMonthlySalary) ? Math.max(0, basicMonthlySalary) : 0
  const years = Number.isFinite(completedYears) ? Math.max(0, completedYears) : 0
  const firstFiveDays = Math.min(years, 5) * 21
  const additionalDays = Math.max(0, years - 5) * 30
  const benefit = (monthly / 30) * (firstFiveDays + additionalDays)
  return roundMoney(Math.min(benefit, monthly * 24))
}
