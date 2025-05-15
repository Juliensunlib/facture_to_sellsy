/**
 * Formate une date au format YYYY-MM-DD
 * @param {Date} date - La date à formater
 * @returns {string} - La date formatée
 */
export function formatDate(date) {
  const d = new Date(date);
  let month = '' + (d.getMonth() + 1);
  let day = '' + d.getDate();
  const year = d.getFullYear();

  if (month.length < 2) month = '0' + month;
  if (day.length < 2) day = '0' + day;

  return [year, month, day].join('-');
}

/**
 * Calcule la date d'échéance à partir d'une date
 * @param {Date} date - La date de départ
 * @param {number} days - Le nombre de jours à ajouter
 * @returns {string} - La date d'échéance formatée
 */
export function calculateDueDate(date, days = 0) {
  const dueDate = new Date(date);
  dueDate.setDate(dueDate.getDate() + days);
  return formatDate(dueDate);
}
