export const DASHBOARD_YEAR = 2026

export const VARIANCE_THRESHOLD_PCT = 0.03

export const ACTUALS_STATUS = {
  ACTIVE:     'active',
  SUPERSEDED: 'superseded',
}

export const UPLOAD_STATUS = {
  SUCCESS:          'success',
  FAILED_UNMAPPED:  'failed_unmapped',
  FAILED_DUPLICATE: 'failed_duplicate',
}

export const UPLOAD_SOURCE = {
  QB_UPLOAD: 'quickbooks_upload',
  QB_INIT:   'qb_initialization',
}

export const COMPANIES = {
  TURF_PRO: 'turf_pro',
  GREENACE: 'greenace',
}

export const COMPANY_LABELS = {
  turf_pro: 'Turf Pro, Inc.',
  greenace: 'GreenAce Lawn Care, LLC',
}

export const MONTH_LABELS = [
  'January', 'February', 'March',     'April',
  'May',     'June',     'July',      'August',
  'September','October', 'November',  'December',
]

export const SECTIONS = {
  REVENUE: 'revenue',
  COGS:    'cogs',
  OPEX:    'opex',
  OTHER:   'other',
}
