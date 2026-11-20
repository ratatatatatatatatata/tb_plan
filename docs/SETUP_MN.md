# `/hicheel/` — тохируулах дараалал

## 1. Сонгосон бүтэц

Нэг компанийн сайт: `https://www.tbplan.mn/`. Сургалт: `/hicheel/`. Админ: `/hicheel/admin.html`. Worker бүх хүсэлтийг эхэлж авч, нийтэд нээлттэй хуудсыг Static Assets-аас, хэрэглэгчийн өгөгдлийг D1-ээс үйлчилнэ. Private MP4/VTT хүсэлтийг нэвтрэлт болон үзэх эрхийн шалгалт давсны дараа л ASSETS binding руу дамжуулна.

Дэд домэйн шаардахгүй. Одоогийн статик сайтад зөвхөн HTML байршуулснаар энэ backend ажиллахгүй; ижил домэйны үйлчилгээг Worker руу шилжүүлэх тусдаа нээлтийн алхам хэрэгтэй.

**Энэ branch production-д байршаагүй.** Cloudflare аккаунт/zone, dedicated D1, Google client, банк, үнэ, хичээлийн медиа тохируулах ажил үлдсэн. Шинэ paid subscription шаардсан сонголтыг ашиглахгүй.

## 2. Free түвшний бодит хүрээ

2026-11-20-нд шалгасан албан мэдээлэл:

| Нөөц | Free хязгаар | Хэрэгжилтэд үзүүлэх нөлөө |
|---|---|---|
| Workers | Аккаунтаар өдөрт 100,000 хүсэлт; хүсэлтэд 10 ms CPU | Энэ сайтаар үйлчлэх бүх хүсэлт Worker-ийг дамжина. Өдөр тутмын хязгаарт хүрвэл 429 гарна. |
| Static Assets | Нэг хувилбарт 20,000 файл; файл бүр ≤25 MiB | Хичээл бүрийг богино MP4 файл болгон бэлтгэнэ. Нэмэлт asset storage төлбөргүй. |
| D1 уншилт/бичилт | Өдөрт 5 сая мөр унших, 100,000 мөр бичих | Индексийн өөрчлөлт мөн бичилтэд тооцогдоно. Хэтэрвэл хүсэлт алдаатай дуусна. |
| D1 багтаамж | Нэг DB 500 MB; аккаунтаар 5 GB, 10 DB | Видеог D1-д хадгалахгүй. Зөвхөн хэрэглэгч, захиалга, эрх, ахиц, медиа зам. |
| Cron | Free аккаунтаар 5 хүртэл trigger | Энд нэг цаг тутмын цэвэрлэгээний trigger тохируулсан. |

Хязгаар нь **аккаунтын бусад хэрэглээтэй нийлж** тооцогдоно. Paid upgrade хийхгүй бол overage нэхэмжлэхийн оронд үйлчилгээний хязгаарлалт үүснэ. Нэг файлын 25 MiB = **26,214,400 byte**; encoder зорилт ≤24 MiB байвал зохистой. Бодит Google нэвтрэлт, seek, видео дамжуулалтын CPU хэрэглээг Free аккаунтын staging дээр хэмжиж байж нээнэ.

Банкны шилжүүлэг гараар баталгаажуулдаг тул QPay холболтын тогтмол төлбөр үүсэхгүй. Банкны өөрийн гүйлгээний шимтгэл болон одоо эзэмшиж буй домэйны сунгалтыг энэ код өөрчлөхгүй.

Эх сурвалж: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Static Assets billing, видео ба Range](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [D1 quota FAQ](https://developers.cloudflare.com/d1/reference/faq/).

## 3. Локал бэлтгэл

Бүтэн checkout дээр Node.js 24 ашиглана. Sparse checkout байвал `git sparse-checkout disable` хийж компанийн эх зураг, видеог материалжуулна. Branch дахь build хамгаалалт дутуу эх медиа байвал deployment build-ийг зогсооно.

```sh
npm ci
npm run check
npm test
npm run build
```

Шинэ, хоосон локал D1-д schema болон каталогийг дарааллаар оруулж болно. Доорх командууд **зөвхөн локал**:

```sh
WRANGLER_SEND_METRICS=false npx wrangler d1 execute tbplan-hicheel-free --local --file cloudflare/schema/001_courses.sql
WRANGLER_SEND_METRICS=false npx wrangler d1 execute tbplan-hicheel-free --local --file cloudflare/schema/002_catalog.sql
WRANGLER_SEND_METRICS=false npx wrangler dev --local
```

`001_courses.sql`-ийг нэг хоосон сан дээр нэг удаа хэрэглэнэ. Дараагийн production өөрчлөлтүүдийг шинэ migration файлд хийнэ. Шалгалтын fake Google token, тест хэрэглэгч, 100₮ үнэ нь зөвхөн in-memory тестэд байдаг; schema/seed-д бодит хэрэглэгч, үнэ үүсгэхгүй.

## 4. Cloudflare ба Google тохиргоо

Эдгээр нь эзэмшигчийн аккаунт дээр гүйцэтгэх **үлдсэн ажил**, энэ branch үүсгээгүй:

1. Cloudflare Workers **Free** түвшин, үлдсэн D1 багтаамжийг шалгах. Dedicated Free D1 үүсгээд `wrangler.jsonc` дахь `REPLACE_WITH_DEDICATED_FREE_D1_ID`-г түүний ID-гаар солих. Өөр бизнесийн санг сонгохгүй.
2. Хоосон зориулалтын D1 дээр `cloudflare/schema/001_courses.sql`, `002_catalog.sql` migration-ийг дарааллаар хэрэглэх. Бүртгэл хаалттай хэвээр байна.
3. Google Identity Services-д Web OAuth client үүсгэх. Authorized JavaScript origin-ийг яг `https://www.tbplan.mn` болгох. Брэнд, домэйн, `/hicheel/privacy.html` мэдээллийг бүрэн тохируулах. Firebase болон Identity Platform subscription хэрэггүй.
4. `GOOGLE_CLIENT_ID`-г Worker variable болгох. GIS нь нийтэд харагдаж болох client ID ашиглана; client secret кодод оруулахгүй.
5. Эзэмшигч Google бүртгэлээр нэвтэрсний дараа өөрийн `/hicheel/api/me`-д буцсан `google_sub` утгыг Worker-ийн `ADMIN_GOOGLE_SUB` болгох. Имэйл хаяг, frontend role, client-ийн хүсэлт админ эрх олгохгүй.
6. `BANK_NAME`, `BANK_ACCOUNT`, `BANK_HOLDER`-т компанийн зөв мэдээллийг тохируулах. `SITE_ORIGIN` нь ажиллах HTTPS origin-той яг таарна. Банкны мэдээллийг repo-д commit хийх шаардлагагүй.

Account-specific variable-ийг Cloudflare тохиргоонд хадгална. Dashboard-д өгсөн variable-ийг дараагийн Wrangler deploy дарж арилгахгүй байлгахын тулд deployment тохиргоо болон `--keep-vars` бодлогыг нэг мөр болгоно. Placeholder утгатай config-ийг бодит тохиргоо гэж андуурч нийтлэхгүй.

Эх сурвалж: [Google Web client бэлтгэх](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid), [Google token серверт шалгах](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).

## 5. 19 бичлэгийг private байдлаар нэмэх

Бүтэн хичээлийн script/quiz JSON, аудио, MP4, VTT-г Git checkout-оос **гадна** хадгална. `cloudflare/media_manifest.example.json`-ийг тэр private хавтасны `manifest.json` болгоод 19 UUID-д тохирох MP4 нэр, бодит `duration_seconds`-г бөглөнө. Бичлэг бэлэн болох хүртэл manifest болон нээлтийг бэлэн гэж үзэхгүй.

Нээлтийн MP4-ийг Монгол хадмалтайгаар render хийхээр төлөвлөсөн. Хадмал нь аль хэдийн дүрсэндээ шингэсэн MP4-д `captions_file` нэмэхгүй: хоёр хадмал давхар гаргахгүй. Хадмалгүй тусдаа MP4 хувилбар ашиглах үед л optional `captions_file`-г зааж өгнө; player түүнийг анхнаасаа асаахгүй. VTT эхийг private production багцад хадгалж болно.

```sh
TBPLAN_PRIVATE_MEDIA_DIR=/absolute/private/course-media REQUIRE_COURSE_MEDIA=1 npm run build
```

Build:

- 19 танигдсан lesson UUID, давхардалгүй файл нэр, файл бүрийн 25 MiB хязгаарыг шалгана.
- Зөвхөн `dist/hicheel/private/` руу MP4/VTT хуулна.
- Медиа mapping SQL-ийг `build-private/asset_mapping.sql` үүсгэнэ. Энэ нь public output болон Git-д орохгүй.
- Нийтэд нээлттэй өөр замд private медиа давхар хуулсан эсэхийг SHA-256-аар шалгана.
- `hicheel/`-ийн зөвшөөрсөн найман файлыг л нийтэлнэ; санамсаргүй `course.json`, narration text, script, quiz export-ыг хуулж нийтлэхгүй. Каталог зөвхөн богино outline schema байна.

Manifest-д optional `worksheet_text` болон `quiz` нэмнэ. `quiz` нь яг хоёр асуулттай array; асуулт бүр зөвхөн `question`, `options` (2–6 текст сонголт), `answer_index` (тэгээс эхэлсэн индекс), `explanation` гэсэн талбартай. Бүтэн narration/script export-ыг manifest руу хуулж болохгүй. Нээлтийн багцад 19 дасгал, 38 асуулт орсныг build-ийн тоогоор шалгана.

Mapping SQL-ийг эхлээд локал D1 дээр шалгаж, зөв dedicated D1-д хэрэглэх хэрэгтэй. Дасгал болон quiz нь D1-ийн `lesson_assets` хүснэгтэд хадгалагдаж, зөвхөн эрхтэй хэрэглэгчийн `/playback` хүсэлтээр ирнэ. Хариулт, тайлбарыг player доорх хэсэгт локал шалгана; оноо эсвэл гэрчилгээ хадгалахгүй. MP4/VTT байхгүй үед API бодит бичлэгийн оронд fake player эсвэл төлбөр амжилттай гэж буцаахгүй.

**Private медиа орсон `dist`-ийг GitHub Pages, энгийн static preview, ZIP public link, public bucket-д байршуулж болохгүй.** Зөвхөн энэ Worker болон хамгаалагдсан ASSETS binding-тэй хамт байршуулна. `assets.run_worker_first=true`, `workers_dev=false`, `preview_urls=false` заавал хэвээр байна. Энэ build шалгалтыг давж гарахгүй бол нээлтийг зогсооно.

## 6. Домэйн ба нээлт

`www.tbplan.mn`-г Worker Custom Domain болгоход active Cloudflare zone, домэйны хяналт хэрэгтэй. Одоогийн CNAME-тай зөрчилдөх тул DNS шилжилт нь тусдаа, шалгаж баталгаажуулах ажил. Одоо байгаа mail MX/TXT, бусад subdomain-ийг хадгална. Apex `tbplan.mn`-ээс сонгосон `www` origin руу чиглүүлэлтийг хамт шалгана. Session cookie нь host тус бүрээр ялгаатай; нэг canonical origin ашиглана.

Эх сурвалж: [Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

Бодит нээлтийн дараалал:

1. Free аккаунт дээр хаалттай staging: бүх эх медиа, 19 хичээл, Google login, админ, үнэ, хугацаа, банкны мэдээлэл зөв эсэх.
2. Шинэ хэрэглэгч, эрхтэй хэрэглэгч, эрхгүй хэрэглэгч, цуцалсан эрхийн бодит браузерын урсгал; iPhone/Safari дээр MP4 seek болон дахин нэвтрэх шалгалт.
3. Нэг бодит банкны орлогыг админ шалгаж зөв захиалгатай холбох. Давхар батлахад хугацаа/эрх давхар нэмэгдэхгүйг шалгах.
4. Бодит Workers CPU, D1 read/write хэрэглээг хэмжих. Free лимитэд багтахгүй бол төлбөр нэмэхгүй; нээлтийг зогсоож шалтгааныг засах.
5. Үнэ, `access_days`-ийн хэрэглэгчид үзүүлэх нөхцөл, буцаалтын бодлого батлагдсаны дараа DB-ийн `courses.enrollment_open=1` болон Worker-ийн `ENROLLMENT_ENABLED=1`-ийг хоёуланг идэвхжүүлэх.

`access_days=null` бол хугацаагүй эрх; энэ нь бизнесийн шийдвэр учраас одоогоор санал болгосон хугацаа гэж үзэхгүй. Үнэ seed-д null бөгөөд дур мэдэн тогтоогоогүй.

## 7. Өдөр тутмын ажиллагаа

Хэрэглэгч захиалга үүсгэхэд сервер DB-ийн үнээр захиалгын snapshot, давтагдахгүй гүйлгээний утга гаргана. Хэрэглэгч өөрийн банкнаас шилжүүлнэ. Админ **банкны бодит орлогыг шалгасны дараа** `/hicheel/admin.html` дээр дүн, банкны баримтын давтагдахгүй лавлагааг оруулж батална. Хэрэглэгчийн «шалгах» товч серверийн статусыг л уншина; эрх нээхгүй.

Эрх цуцлах үйлдэл шинэ видео хүсэлтийг хаана. Банкны мөнгийг автоматаар буцаахгүй. Ижил баримтын лавлагаагаар өөр захиалга батлахыг сервер хориглоно. Админ дэлгэц сүүлийн 100 захиалгыг харуулна; энэ нь бүрэн нягтлан бодох программ биш.

Цаг тутмын Cron нь 24 цагаас хуучин rate-limit мөрөөс 500, хугацаа дууссан session-оос 500 хүртэл устгана. Энэ хязгаар нь нэг ажиллуулалтын ачааллыг тогтооно; их backlog үүсвэл хэд хэдэн ажиллуулалт шаардлагатай. Хэрэглэгчийн үндсэн бүртгэл, захиалга, төлбөрийн аудит, сургалтын ахиц автоматаар устахгүй; тэдгээрийн хадгалах хугацааг компани тогтооно.

## 8. Үйлчилгээний нөхцөл

Cloudflare Developer Platform-ийн Free үйлчилгээ дээр Vercel Hobby шиг бүхэлд нь «personal, noncommercial only» нөхцөл олдоогүй. Энэ сонголт нь Workers Static Assets-ийн видео үйлчлэх албан заавар болон Developer Platform-ийн нөхцөлд тулгуурласан. Free үйлчилгээ нь хязгааргүй ачааллын баталгаа биш; provider usage/abuse нөхцөл үйлчилнэ. Картын дугаар, CVC, банкны нууц үг энэ сайтаар цуглуулахгүй.

Эх сурвалж: [Cloudflare ерөнхий нөхцөл](https://www.cloudflare.com/terms/), [Developer Platform нөхцөл](https://www.cloudflare.com/service-specific-terms-developer-platform/), [CDN ба Application Services нөхцөл](https://www.cloudflare.com/service-specific-terms-application-services/).
