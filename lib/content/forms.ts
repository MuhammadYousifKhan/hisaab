// Strings for the public forms (apply, sign in) in English and Urdu. Applicants with no credit file are the
// people least likely to be comfortable in English, so the way in speaks Urdu too.
import type { Lang } from '@/lib/engine/types';

export const FORM_T = {
  en: {
    applyTitle: 'Apply for a loan', applyLead: 'No credit history needed. Your repayments here become your record.',
    name: 'Full name', phone: 'Mobile number', work: 'Your work', workPh: 'e.g. tailor, rickshaw driver, shop owner', city: 'City',
    amount: 'Amount (Rs)', amountPh: '5,000 to 100,000', weeks: 'Repay over (weeks)', weeksOpt: '{n} weeks', ch: 'How you will pay',
    income: 'About how much do you earn in a month? (Rs)', incomeHint: 'Your best guess is fine. Irregular income is normal.',
    years: 'How long have you done this work?', y0: 'Less than a year', y1: '1 to 3 years', y3: 'More than 3 years',
    refName: 'Someone who knows your work (optional)', refNamePh: 'e.g. your shop’s landlord or a regular customer', refPhone: 'Their mobile number (optional)',
    aboutYou: 'About you', aboutLoan: 'The loan', aboutWork: 'Your work and income', aboutPin: 'Your PIN',
    pin: 'Choose a PIN', pinPh: '4 to 6 digits', pin2: 'PIN again', submit: 'Apply', sending: 'Sending…',
    done: 'Application received. Once it is approved, sign in with your mobile number and the PIN you chose.', goSignIn: 'Go to sign in',
    have: 'Already have an account?', signIn: 'Sign in',
    eName: 'Enter your full name.', eWork: 'Tell us what work you do.', eCity: 'Enter your city.',
    eAmount: 'Choose an amount from Rs 5,000 to Rs 100,000, in whole rupees.', eWeeks: 'Choose between 4 and 52 weeks.',
    eIncome: 'Enter about how much you earn in a month, in rupees.', eYears: 'Choose how long you have done this work.',
    ePin: 'Your PIN must be 4 to 6 digits.', ePin2: 'The two PINs don’t match.', ePhone: 'Enter a mobile number like 0300 1234567.',
    eRefPhone: 'Enter their mobile number like 0300 1234567, or leave it blank.', eTooMany: 'Too many applications from this connection. Try again later.',
    eBorrower: 'This number already has an account. Sign in instead.', ePending: 'An application from this number is already being reviewed.', eForm: 'Check the form.',
    lTitle: 'Sign in', lId: 'Phone number or username', lSecret: 'PIN or password', lSubmit: 'Sign in', lSending: 'Signing in…',
    lNew: 'New here?', lApply: 'Apply for a loan',
    lEmpty: 'Enter your phone number or username, and your PIN or password.', lWrong: 'That sign-in doesn’t match. Check it and try again.',
    lLocked: 'Too many wrong tries. Try again in {m} {unit}, or ask the lender to reset your PIN.', lStaffLocked: 'Too many wrong tries. Try again in {m} {unit}.',
    lPending: 'Your application is still being reviewed. You can sign in once it is approved.', lDeclined: 'Your application was not approved this time.',
    minute: 'minute', minutes: 'minutes',
  },
  ur: {
    applyTitle: 'قرض کے لیے درخواست', applyLead: 'کریڈٹ ہسٹری کی ضرورت نہیں۔ یہاں آپ کی ادائیگیاں ہی آپ کا ریکارڈ بنیں گی۔',
    name: 'پورا نام', phone: 'موبائل نمبر', work: 'آپ کا کام', workPh: 'مثلاً درزی، رکشہ ڈرائیور، دکاندار', city: 'شہر',
    amount: 'رقم (روپے)', amountPh: '5,000 سے 100,000', weeks: 'واپسی کی مدت (ہفتے)', weeksOpt: '{n} ہفتے', ch: 'آپ کیسے ادائیگی کریں گے',
    income: 'آپ مہینے میں تقریباً کتنا کماتے ہیں؟ (روپے)', incomeHint: 'اندازہ کافی ہے۔ آمدنی کا کم زیادہ ہونا عام بات ہے۔',
    years: 'آپ یہ کام کب سے کر رہے ہیں؟', y0: 'ایک سال سے کم', y1: '1 سے 3 سال', y3: '3 سال سے زیادہ',
    refName: 'کوئی جو آپ کے کام کو جانتا ہو (اختیاری)', refNamePh: 'مثلاً دکان کا مالک یا مستقل گاہک', refPhone: 'ان کا موبائل نمبر (اختیاری)',
    aboutYou: 'آپ کے بارے میں', aboutLoan: 'قرض', aboutWork: 'آپ کا کام اور آمدنی', aboutPin: 'آپ کا پن',
    pin: 'پن منتخب کریں', pinPh: '4 سے 6 ہندسے', pin2: 'پن دوبارہ', submit: 'درخواست بھیجیں', sending: 'بھیجا جا رہا ہے…',
    done: 'درخواست موصول ہو گئی۔ منظوری کے بعد اپنے موبائل نمبر اور منتخب کردہ پن سے سائن ان کریں۔', goSignIn: 'سائن ان کریں',
    have: 'پہلے سے اکاؤنٹ ہے؟', signIn: 'سائن ان',
    eName: 'اپنا پورا نام لکھیں۔', eWork: 'بتائیں آپ کیا کام کرتے ہیں۔', eCity: 'اپنا شہر لکھیں۔',
    eAmount: '5,000 سے 100,000 روپے تک پوری رقم لکھیں۔', eWeeks: '4 سے 52 ہفتوں میں سے چنیں۔',
    eIncome: 'مہینے کی تقریباً آمدنی روپوں میں لکھیں۔', eYears: 'بتائیں آپ یہ کام کب سے کر رہے ہیں۔',
    ePin: 'پن 4 سے 6 ہندسوں کا ہونا چاہیے۔', ePin2: 'دونوں پن ایک جیسے نہیں۔', ePhone: 'موبائل نمبر اس طرح لکھیں: 0300 1234567',
    eRefPhone: 'ان کا نمبر اس طرح لکھیں: 0300 1234567، یا خالی چھوڑ دیں۔', eTooMany: 'اس کنکشن سے بہت زیادہ درخواستیں آئیں۔ بعد میں کوشش کریں۔',
    eBorrower: 'اس نمبر کا اکاؤنٹ پہلے سے موجود ہے۔ سائن ان کریں۔', ePending: 'اس نمبر سے ایک درخواست پہلے ہی زیرِ غور ہے۔', eForm: 'فارم دوبارہ دیکھیں۔',
    lTitle: 'سائن ان', lId: 'فون نمبر یا یوزر نیم', lSecret: 'پن یا پاس ورڈ', lSubmit: 'سائن ان', lSending: 'سائن ان ہو رہا ہے…',
    lNew: 'نئے ہیں؟', lApply: 'قرض کے لیے درخواست دیں',
    lEmpty: 'اپنا فون نمبر یا یوزر نیم، اور پن یا پاس ورڈ لکھیں۔', lWrong: 'یہ معلومات درست نہیں۔ دوبارہ دیکھ کر کوشش کریں۔',
    lLocked: 'بہت زیادہ غلط کوششیں۔ {m} {unit} بعد دوبارہ کوشش کریں، یا ادارے سے پن بدلوائیں۔', lStaffLocked: 'بہت زیادہ غلط کوششیں۔ {m} {unit} بعد دوبارہ کوشش کریں۔',
    lPending: 'آپ کی درخواست ابھی زیرِ غور ہے۔ منظوری کے بعد سائن ان کر سکیں گے۔', lDeclined: 'اس بار آپ کی درخواست منظور نہیں ہوئی۔',
    minute: 'منٹ', minutes: 'منٹ',
  },
} as const;

export type FormKey = keyof typeof FORM_T.en;

export function ft(lang: Lang, key: FormKey, params?: Record<string, string | number>): string {
  let s: string = FORM_T[lang][key] ?? FORM_T.en[key];
  if (params) s = s.replace(/\{(\w+)\}/g, (m, x) => (params[x] !== undefined ? String(params[x]) : m));
  return s;
}
export const isFormKey = (k: unknown): k is FormKey => typeof k === 'string' && k in FORM_T.en;
