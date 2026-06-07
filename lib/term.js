'use strict';

/**
 * Compute the German academic term label for a given date (R2).
 *
 *   - 15 March .. 30 September  -> "Sommersemester {year}"
 *   - 01 October .. 31 December -> "Wintersemester {year}"
 *   - 01 January .. 14 March    -> "Wintersemester {year - 1}"
 *
 * A Wintersemester is named by the calendar year in which it starts, so the
 * Jan 1 .. Mar 14 tail belongs to the previous year's Wintersemester.
 *
 * @param {Date} [date=new Date()] the date the evaluation is conducted
 * @returns {string} e.g. "Sommersemester 2026"
 */
function computeTerm(date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1; // 1..12
  const day = date.getDate();

  const afterMarch15 = month > 3 || (month === 3 && day >= 15);
  const beforeOctober = month < 10; // months 1..9 (Sep 30 included, Oct excluded)

  if (afterMarch15 && beforeOctober) {
    return `Sommersemester ${year}`;
  }
  if (month >= 10) {
    return `Wintersemester ${year}`;
  }
  // January 1 .. March 14
  return `Wintersemester ${year - 1}`;
}

module.exports = { computeTerm };
