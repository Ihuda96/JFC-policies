# Supabase Manual Deployment

هذا الدليل مخصص لمشروع الإنتاج:

- Project URL: `https://sbhpbfoadltmjsziayum.supabase.co`
- Project reference: `sbhpbfoadltmjsziayum`

لا يحتاج هذا النشر إلى Supabase CLI أو access token أو database password أو service-role key.

## 1. افتح مشروع Supabase

1. افتح لوحة Supabase.
2. اختر المشروع بالمرجع `sbhpbfoadltmjsziayum`.
3. تأكد أن الرابط الظاهر للمشروع هو `https://sbhpbfoadltmjsziayum.supabase.co`.

## 2. افتح SQL Editor

1. من القائمة الجانبية اختر `SQL Editor`.
2. أنشئ query جديدًا.
3. افتح الملف المحلي `supabase/DEPLOY_TO_SUPABASE.sql`.
4. انسخ محتوى الملف كاملًا كما هو.

## 3. شغّل ملف النشر

1. الصق محتوى `supabase/DEPLOY_TO_SUPABASE.sql` في SQL Editor.
2. اضغط `Run`.
3. يجب أن ينتهي التنفيذ بدون أخطاء.

الملف يحتوي `begin;` و `commit;`. إذا فشل التنفيذ قبل `commit` فلن تُحفظ التغييرات الجزئية.

## 4. تحقق من الجداول وRLS

من `Table Editor` تحقق من وجود الجداول التالية:

- `profiles`
- `categories`
- `policies`
- `policy_versions`
- `policy_files`
- `policy_metadata`
- `review_comments`
- `approval_actions`
- `notifications`
- `file_processing_jobs`
- `audit_logs`
- `app_settings`

ثم من كل جدول مهم تأكد أن `RLS enabled`.

يمكن التحقق من SQL Editor:

```sql
select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'profiles',
    'policies',
    'policy_versions',
    'policy_files',
    'policy_metadata',
    'review_comments',
    'approval_actions',
    'notifications',
    'file_processing_jobs',
    'audit_logs',
    'app_settings'
  )
order by tablename;
```

كل صف يجب أن يظهر `rowsecurity = true`.

## 5. تحقق من Storage buckets الخاصة

من `Storage` تحقق من وجود الحاويات التالية:

- `policy-originals`
- `policy-previews`
- `policy-approved`

كل bucket يجب أن يكون `Private` وليس public.

يمكن التحقق من SQL Editor:

```sql
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id in ('policy-originals', 'policy-previews', 'policy-approved')
order by id;
```

كل صف يجب أن يظهر `public = false`.

## 6. أنشئ أول مدير نظام بأمان

1. افتح `Authentication`.
2. أنشئ أول مستخدم حقيقي لمدير النظام أو اطلب منه التسجيل من صفحة الدخول إذا كان التسجيل مفعّلًا.
3. بعد ظهور المستخدم في `auth.users`، شغّل SQL التالي مع استبدال البريد فقط:

```sql
update public.profiles
set
  full_name = 'Suoaljohani',
  role = 'system_admin',
  status = 'active',
  department = 'إدارة النظام',
  job_title = 'مدير نظام',
  updated_at = now()
where email = 'ضع_بريد_مدير_النظام_هنا';
```

4. تحقق أن صفًا واحدًا فقط تأثر.

بعد دخول مدير النظام يمكن تفعيل الحسابات الأخرى من صفحة `المستخدمون`.

الأدوار المطلوبة عند إنشاء الحسابات:

- `Haljohani` = `quality_staff`
- `Halotaibi` = `quality_manager`
- `Suoaljohani` = `system_admin`

## 7. اختبر المصادقة

1. افتح التطبيق.
2. سجّل الدخول بحساب `Suoaljohani`.
3. تحقق من ظهور لوحة مدير النظام.
4. من صفحة `المستخدمون` فعّل حساب مدير الجودة `Halotaibi` وحساب موظف الجودة `Haljohani`.
5. سجّل الدخول بحساب موظف الجودة وارفع ملف PDF أو DOCX.
   - إذا كان الملف DOCX، ارفع معه PDF مطابقًا مصدّرًا من Word حتى تظهر المعاينة النهائية بدقة.
6. اضغط `إرسال للاعتماد`.
7. سجّل الدخول بحساب مدير الجودة.
8. افتح `طلبات الاعتماد` واعتمد السياسة أو أعدها للتعديل.
9. بعد الاعتماد تحقق من ظهور السياسة في `مكتبة السياسات`.

إذا لم تكن الجداول منشورة أو فشل RLS، سيعرض التطبيق رسالة إعداد مطلوبة بدل محتوى وهمي.

## 8. التراجع الآمن عند الفشل

إذا فشل تشغيل `DEPLOY_TO_SUPABASE.sql`:

1. لا تعيد تشغيل أجزاء متفرقة من الملف.
2. اقرأ رسالة الخطأ في SQL Editor.
3. إذا ظهر الخطأ قبل `commit`، فالتغييرات داخل المعاملة لم تُحفظ.
4. أصلح السبب في الملف ثم أعد تشغيل الملف كاملًا.
5. إذا حدث فشل بعد تنفيذ سابق ناجح جزئيًا بسبب تشغيل يدوي خارج الملف، شغّل الفحص التالي:

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'profiles',
    'policies',
    'policy_versions',
    'policy_files',
    'policy_metadata',
    'review_comments',
    'approval_actions',
    'notifications',
    'file_processing_jobs',
    'audit_logs',
    'app_settings'
  )
order by table_name;
```

6. لا تحذف الجداول التي تحتوي بيانات إنتاجية.
7. إذا كان النشر أوليًا ولا توجد بيانات إنتاجية، يمكن حذف العناصر التي أنشئت يدويًا بالخطأ ثم إعادة تشغيل الملف كاملًا.
8. عند وجود بيانات إنتاجية، أنشئ migration إصلاحي بدل rollback يدوي شامل.
