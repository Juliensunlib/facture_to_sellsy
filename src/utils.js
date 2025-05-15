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

/**
 * Vérifie si une date est aujourd'hui
 * @param {Date|string} date - La date à vérifier
 * @returns {boolean} - Vrai si la date est aujourd'hui
 */
export function isToday(date) {
  const today = new Date();
  const checkDate = new Date(date);
  
  return (
    today.getDate() === checkDate.getDate() &&
    today.getMonth() === checkDate.getMonth() &&
    today.getFullYear() === checkDate.getFullYear()
  );
}
