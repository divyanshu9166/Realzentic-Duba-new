/**
 * Duplicate-lead detection — PURE helpers (no DB/IO).
 *
 * These functions back Module 8 (Duplicate Lead Detection). They are kept free
 * of any database or side-effecting logic so they can be unit- and
 * property-tested in isolation and reused by the `leads.ts` server actions.
 *
 * Design references:
 *   - Property 40 — duplicate detection criteria (`isDuplicate`).      Req 11.1
 *   - Property 41 — confidence is a bounded integer [0,100].           Req 11.2
 *   - Property 43 — dedup-report groups are valid (size ≥ 2).          Req 11.6
 *
 * Duplicate criteria (Req 11.1 / design "Key Decisions"):
 *   A candidate and an existing contact are duplicates when ANY of:
 *     1. their normalized phone numbers are equal, OR
 *     2. their lowercased email addresses are equal, OR
 *     3. the Levenshtein distance between their full names is < 3.
 *
 * NOTE ON EMPTY VALUES: a clause only contributes a match when the compared
 * value is actually present. Two records that both lack a phone (or both lack
 * an email) are NOT treated as phone/email matches — an absent value is not an
 * "address" or "number" to compare. This avoids the degenerate result where
 * every record with blank fields collapses into one duplicate group. The name
 * clause likewise requires both names to be non-blank.
 */

/**
 * Minimal shape required to compare two contacts/leads for duplication.
 * Mirrors the relevant `Contact` columns (`name`, `phone`, `email`).
 */
export interface DedupRecord {
    /** Optional identifier used to key dedup-report groups. */
    id?: number | string
    /** Full name (required on `Contact`). */
    name: string
    /** Phone number, in any human format; normalized before comparison. */
    phone: string
    /** Optional email address. */
    email?: string | null
}

/**
 * Compute the Levenshtein edit distance between two strings.
 *
 * Counts the minimum number of single-character insertions, deletions, or
 * substitutions needed to turn `a` into `b`. Strings are compared by Unicode
 * code point (via `Array.from`) so multi-byte characters and emoji count as a
 * single edit unit rather than as their surrogate halves.
 *
 * Pure, symmetric, and deterministic: `levenshtein(a, b) === levenshtein(b, a)`.
 *
 * @returns A non-negative integer; `0` when the strings are identical.
 */
export function levenshtein(a: string, b: string): number {
    const s = Array.from(a)
    const t = Array.from(b)
    const m = s.length
    const n = t.length

    if (m === 0) return n
    if (n === 0) return m

    // Rolling two-row DP to keep memory at O(min(m, n)).
    let prev = new Array<number>(n + 1)
    let curr = new Array<number>(n + 1)

    for (let j = 0; j <= n; j++) prev[j] = j

    for (let i = 1; i <= m; i++) {
        curr[0] = i
        for (let j = 1; j <= n; j++) {
            const cost = s[i - 1] === t[j - 1] ? 0 : 1
            curr[j] = Math.min(
                prev[j] + 1, // deletion
                curr[j - 1] + 1, // insertion
                prev[j - 1] + cost // substitution
            )
        }
        // Swap rows for the next iteration.
        const tmp = prev
        prev = curr
        curr = tmp
    }

    return prev[n]
}

/**
 * Normalize a phone number for exact comparison.
 *
 * Strips all formatting (spaces, dashes, parentheses, dots, leading `+`) so
 * only digits remain, then canonicalizes UAE mobile forms to `9715XXXXXXXX`:
 *   - `05XXXXXXXX` and `5XXXXXXXX` receive the UAE country code;
 *   - `00971...` is normalized to `971...`.
 *
 * Numbers that do not match these shapes are returned as their digit string so
 * comparison stays deterministic. Non-digit input yields an empty string.
 */
export function normalizePhone(phone: string | null | undefined): string {
    if (!phone) return ''

    let digits = String(phone).replace(/\D/g, '')

    if (digits.startsWith('00971')) digits = digits.slice(2)
    if (digits.startsWith('971') && digits.length >= 12) return digits
    if (digits.length === 10 && digits.startsWith('05')) return `971${digits.slice(1)}`
    if (digits.length === 9 && digits.startsWith('5')) return `971${digits}`

    return digits
}

/**
 * Normalize an email for case-insensitive comparison: trimmed and lowercased.
 * Missing emails normalize to the empty string.
 */
function normalizeEmail(email: string | null | undefined): string {
    if (!email) return ''
    return String(email).trim().toLowerCase()
}

/** Levenshtein-distance threshold below which two names are a fuzzy match. */
export const NAME_DISTANCE_THRESHOLD = 3

/** True when both phones are present and their normalized forms are equal. */
function phonesMatch(a: DedupRecord, b: DedupRecord): boolean {
    const pa = normalizePhone(a.phone)
    const pb = normalizePhone(b.phone)
    return pa !== '' && pa === pb
}

/** True when both emails are present and their normalized forms are equal. */
function emailsMatch(a: DedupRecord, b: DedupRecord): boolean {
    const ea = normalizeEmail(a.email)
    const eb = normalizeEmail(b.email)
    return ea !== '' && ea === eb
}

/** True when both names are non-blank and within the Levenshtein threshold. */
function namesMatch(a: DedupRecord, b: DedupRecord): boolean {
    const na = (a.name ?? '').trim()
    const nb = (b.name ?? '').trim()
    if (na === '' || nb === '') return false
    return levenshtein(na, nb) < NAME_DISTANCE_THRESHOLD
}

/**
 * Decide whether two records are duplicates per Req 11.1 / design Property 40.
 *
 * Returns true when their normalized phone numbers are equal, OR their
 * lowercased emails are equal, OR the Levenshtein distance between their full
 * names is below {@link NAME_DISTANCE_THRESHOLD}. Symmetric in its arguments.
 */
export function isDuplicate(candidate: DedupRecord, existing: DedupRecord): boolean {
    return (
        phonesMatch(candidate, existing) ||
        emailsMatch(candidate, existing) ||
        namesMatch(candidate, existing)
    )
}

/**
 * Score how confidently `candidate` and `existing` are the same person.
 *
 * Returns an integer in `[0, 100]` (design Property 41 / Req 11.2). The score
 * is the strongest matching signal between the two records:
 *   - exact normalized phone match → 100 (the unique, authoritative key);
 *   - exact email match           → 95;
 *   - fuzzy name match            → scales with edit distance: distance 0 → 100,
 *     1 → 67, 2 → 33 (i.e. `round(100 × (threshold − distance) / threshold)`).
 *
 * When no clause matches the score is `0`.
 */
export function duplicateConfidence(candidate: DedupRecord, existing: DedupRecord): number {
    const scores: number[] = []

    if (phonesMatch(candidate, existing)) scores.push(100)
    if (emailsMatch(candidate, existing)) scores.push(95)

    const na = (candidate.name ?? '').trim()
    const nb = (existing.name ?? '').trim()
    if (na !== '' && nb !== '') {
        const distance = levenshtein(na, nb)
        if (distance < NAME_DISTANCE_THRESHOLD) {
            scores.push(
                Math.round(
                    (100 * (NAME_DISTANCE_THRESHOLD - distance)) / NAME_DISTANCE_THRESHOLD
                )
            )
        }
    }

    if (scores.length === 0) return 0

    const best = Math.max(...scores)
    // Clamp defensively so the result is always a bounded integer in [0, 100].
    return Math.max(0, Math.min(100, Math.round(best)))
}

/**
 * Partition records into duplicate groups (design Property 43 / Req 11.6).
 *
 * Records are grouped by the connected components of the duplicate relation:
 * two records share a group when {@link isDuplicate} links them directly or
 * transitively through other records. Only components with 2 or more records
 * are returned, so the result is empty when there are no duplicates.
 *
 * Implemented with union-find for near-linear grouping. Input order is
 * preserved within each group, and groups are returned in order of their
 * earliest member.
 *
 * @returns An array of groups, each an array of 2+ records.
 */
export function dedupGroups<T extends DedupRecord>(records: readonly T[]): T[][] {
    const n = records.length
    if (n < 2) return []

    // Union-find over record indices.
    const parent = Array.from({ length: n }, (_, i) => i)

    const find = (x: number): number => {
        let root = x
        while (parent[root] !== root) root = parent[root]
        // Path compression.
        let cur = x
        while (parent[cur] !== root) {
            const next = parent[cur]
            parent[cur] = root
            cur = next
        }
        return root
    }

    const union = (a: number, b: number): void => {
        const ra = find(a)
        const rb = find(b)
        if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb)
    }

    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            if (isDuplicate(records[i], records[j])) union(i, j)
        }
    }

    // Collect members per root, preserving input order.
    const byRoot = new Map<number, T[]>()
    for (let i = 0; i < n; i++) {
        const root = find(i)
        const bucket = byRoot.get(root)
        if (bucket) bucket.push(records[i])
        else byRoot.set(root, [records[i]])
    }

    // Keep only real groups (size ≥ 2); Map preserves insertion (earliest) order.
    const groups: T[][] = []
    for (const bucket of byRoot.values()) {
        if (bucket.length >= 2) groups.push(bucket)
    }
    return groups
}
