import { z } from 'zod'

export const generatePayrollSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/, 'Period must be YYYY-MM format'),
  workingDays: z.number().min(1).max(31).default(26),
  // Optional per-staff LOP overrides from the Attendance Summary panel
  // Record<staffId (string), lopDays (number)>
  lopOverrides: z.record(z.string(), z.number().min(0).max(31)).optional(),
})

export const updateStaffPayrollSchema = z.object({
  staffId: z.number(),
  basicSalary: z.number().min(0),
  designation: z.string().optional(),
  emiratesId: z.string().optional(),
  laborCardNo: z.string().optional(),
  mohreNo: z.string().optional(),
  iban: z.string().optional(),
  bankName: z.string().optional(),
  visaStatus: z.string().optional(),
  eosbAccrued: z.number().min(0).default(0),
  wpsRegistered: z.boolean().default(false),
})
