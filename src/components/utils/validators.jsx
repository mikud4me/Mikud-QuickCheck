/**
 * בדיקת תקינות תעודת זהות ישראלית
 */
export function isValidIsraeliID(id) {
  if (!id || typeof id !== 'string') return false;
  
  // הסרת רווחים ומקפים
  const cleanId = id.replace(/[\s-]/g, '');
  
  // בדיקת אורך - 9 ספרות (או 8 עם 0 מוביל)
  if (!/^\d{8,9}$/.test(cleanId)) return false;
  
  // השלמה ל-9 ספרות
  const paddedId = cleanId.padStart(9, '0');
  
  // אלגוריתם ספרת ביקורת ישראלית
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let digit = parseInt(paddedId[i]);
    let step = digit * ((i % 2) + 1);
    sum += step > 9 ? step - 9 : step;
  }
  
  return sum % 10 === 0;
}

/**
 * בדיקת תקינות אימייל
 */
export function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim());
}

/**
 * בדיקת תקינות מספר טלפון ישראלי
 */
export function isValidIsraeliPhone(phone) {
  if (!phone || typeof phone !== 'string') return false;
  
  // הסרת רווחים ומקפים
  const cleanPhone = phone.replace(/[\s-]/g, '');
  
  // בדיקת פורמטים נפוצים:
  // 05XXXXXXXX (10 ספרות)
  // 97205XXXXXXXX (12 ספרות עם קידומת בינלאומית)
  // 0XXXXXXXX (9 ספרות - טלפון קווי)
  const phoneRegex = /^(05\d{8}|972(5\d{8}|[2-9]\d{7,8})|0[2-9]\d{7,8})$/;
  
  return phoneRegex.test(cleanPhone);
}

/**
 * נירמול מספר טלפון לפורמט אחיד
 */
export function normalizePhone(phone) {
  if (!phone) return '';
  
  const cleanPhone = phone.replace(/[\s-]/g, '');
  
  // המרה לפורמט ישראלי סטנדרטי (05XXXXXXXX)
  if (cleanPhone.startsWith('972')) {
    return '0' + cleanPhone.slice(3);
  }
  
  return cleanPhone;
}