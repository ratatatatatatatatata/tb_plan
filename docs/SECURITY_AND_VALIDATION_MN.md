# Хамгаалалт ба баталгаажуулалт

## Эрхийн хил

Frontend товч, HTML, lesson UUID, MP4 зам мэдэх нь үзэх эрх олгохгүй. Google ID token-ийг сервер RSA гарын үсэг, issuer, audience, хугацаа, nonce, verified email-аар шалгана. Хэрэглэгчийн үндсэн таних утга нь Google-ийн өөрчлөгдөхгүй `sub` байна. D1-д session-ийн SHA-256 hash хадгална; browser-д 24 цагийн Secure, HttpOnly, SameSite=Strict, host-only cookie өгнө.

POST хүсэлт exact Origin ба session-тэй нэг origin дахь CSRF nonce шаардана. `user_id`, `amount_mnt`, admin role-ийг хэрэглэгчийн хүсэлтээс итгэж авахгүй. SQL prepared statements ашиглана. Нэг IP-ээс нэвтрэх хүсэлт минутанд 10, нэвтэрсэн хэрэглэгчийн POST минутанд 120-аар хязгаарлагдана. IP-гийн hash л rate-limit түлхүүрт хадгалагдана.

Manual payment оруулах нэг statement нь SQLite trigger-ээр захиалгыг төлөгдсөн болгох, эрх олгох, аудит бичихийг атомик гүйцэтгэнэ. Алдаа гарвал эрхийг тал дутуу олгохгүй. Bank reference давхардахгүй. Буцаалтын хүсэлт нь мөнгө шилжүүлэх код ажиллуулахгүй.

## Видео

`run_worker_first=true` нь **бүх** хүсэлтэд үйлчилнэ. `/hicheel/private/` руу GET, HEAD, Range бүр нэвтрэлт, session expiry, lesson/course publication, entitlement шалгуулна. Түүний дараа л ASSETS binding-аас файл авна. Encode хийсэн slash/үсэг, mixed-case path нь public asset fallback руу шилжихгүй.

MP4-г нэг файл болгон stream хийж, single-byte-range GET-д 206 болон зөв Content-Range/Length өгнө. HEAD нь 200/full Content-Length, body-гүй; If-Range баталгаажих validator байхгүй тул бүтэн 200 буцаана. Compression byte mismatch гаргахгүйн тулд identity encoding авна; өөр Content-Encoding ирвэл 503.

Private хариулт `Cache-Control: private, no-store`, `Vary: Cookie`, same-origin resource policy-той. Shared cache эсвэл public media URL ашиглахгүй. D1 quota/availability алдахад 503; Worker Free request quota дуусахад platform 429; аль ч тохиолдолд private static fallback байхгүй. [Cloudflare-ийн тайлбар](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), [HTTP Range стандарт](https://www.rfc-editor.org/rfc/rfc9110.html#name-range).

Нэгэнт эрхтэй браузерт ирсэн байтыг screen record/download хийхээс энэ хамгаалалт сэргийлэхгүй. `controlsList=nodownload` нь DRM биш. Эрх цуцлах нь дараагийн хүсэлтэд үйлчилнэ; өмнө эхэлсэн stream-ийг дундаас нь хүчээр татахгүй.

## Public build

Root-ийн зөвшөөрсөн HTML/CSS/JS болон Git-д байгаа компанийн эх media замуудыг л хуулна. `hicheel/`-ээс index.html, app.js, catalog.js, styles.css, fonts.css, admin.html, admin.js, privacy.html гэсэн найман файл нийтэд нээлттэй. Catalog нь 5 бүлэг/19 хичээлийн exact-key schema: бүтэн narration, quiz, worksheet, private URL нэмэхийг зөвшөөрөхгүй; objective дээд тал нь 400 тэмдэгт.

Медиа зөвхөн тусдаа private manifest-ээс орно. Build нь 25 MiB, 20,000 file, symlink, өөр public замд давхардсан private bytes, backend/test/config output, дурын course.json export-ыг шалгана. Git ignore нь private media, generated dist, mapping SQL, environment утга, dependency/runtime state-ийг тусгаарлана.

## Автомат шалгалтын хүрээ

Node.js 24, SQLite-backed D1 test adapter, Web Request/Response API ашигласан **13 тест**:

1. Бүх хүсэлт Worker-ээр дамжих config; alternate preview, paid binding хориг.
2. Public catalog-ийн exact keys; narration, quiz, урт агуулга, нэмэлт executable export хориг.
3. Public output дахь paid export, private duplicate, том файл, backend source хориг.
4. Public API зөвхөн 19 outline/5 бүлэг буцаах.
5. Серверийн үнэ, order ownership, зөв админ, зөв дүн, давхар батлалт, bank reference reuse.
6. CSRF ба гадаад Origin хүсэлт захиалга үүсгэхгүй.
7. Private GET/HEAD/Range/encoded path нь эрхгүй үед ASSETS хүрэхгүй.
8. Range-ийн бодит byte body/header, HEAD, If-Range, 416, compression алдаанд хаагдах.
9. Цуцалсан/хугацаа дууссан эрх нь дараагийн медиа болон progress хүсэлтийг хориглох.
10. D1 quota алдаа private asset руу унахгүй.
11. Хугацаа дууссан session/rate мөрийн cleanup нэг хүснэгтэд 500-аас хэтрэхгүй; идэвхтэй өгөгдөл үлдэх.
12. Private worksheet/quiz нь эрхгүй хэрэглэгчид хаалттай; public catalog-д агуулга орохгүй; зөв эрхтэй хэрэглэгчид 2 асуулт ирэх; буруу answer index/production export татгалзах.
13. RSA-гаар үнэхээр гарын үсэг зурсан Google test token-ийн зөвшөөрөл/татгалзалт, login cookie, hashed session, logout.

Энэ багц бодит банк эсвэл Google аккаунтыг дуурайлган «баталгаажуулсан» гэж үзэхгүй. Жинхэнэ OAuth/browser урсгал, Cloudflare production CPU, domain/cookie, бодит MP4-ийн Safari seek нь нээлтийн өмнөх үлдсэн шалгалт.

## Runtime ба өгөгдлийн хязгаар

2026-11-20-ны локал үр дүн:

| Шалгалт | Үр дүн |
|---|---|
| `npm test` | 13/13 тэнцсэн |
| `npm run check` | 15 JavaScript module-ийн syntax зөв |
| Wrangler D1 `--local` schema/seed | 22 schema statement, 25 catalog statement амжилттай; 19 хичээл, 5 бүлэг |
| Sparse source build | 17 public файл; 0 private хичээл; enrollment хаалттай |
| Private manifest → local D1 | Зохиомол test fixture-ээр 19 lesson mapping, 19 worksheet, 38 quiz question; public output-д practice агуулга ороогүй; fixture медиа дараа нь цэвэрлэгдсэн |
| Wrangler `deploy --dry-run` | Bundle амжилттай; upload хийгээгүй |
| Бодит localhost HTTP | Нүүр болон `/hicheel/` 200; catalog 19/5, enrollment false; signed-out `/me` 200; private GET/HEAD/encoded GET 401; HEAD body хоосон |

Local Worker болон HTTP client-ийг нэг процессоос ажиллуулж дээрх хариуг шалгасан. Зурагтай браузерын visual QA, жинхэнэ Google нэвтрэлт, live банк, production deployment энэ шалгалтад ороогүй. Бүтэн компанийн эх media дутуу sparse checkout дээр энгийн production build зориудаар зогсдог.

Схем, public seed-ийг local Wrangler D1 дээр мөн гүйцэтгэж шалгасан. Wrangler dry-run нь Worker-ийг compile хийдэг; аккаунтад upload хийхгүй. Test-ийн SQLite adapter нь Cloudflare production орчны бүх үзүүлэлтийг орлохгүй.

Session хадгалалт аккаунт бүрд сүүлийн тав хүртэл. Цаг тутмын indexed cleanup нь хуучин rate-limit түлхүүр ба дууссан session-ийг багцаар устгана. Урьдчилан асар их хүсэлт ирвэл Free quota болон cleanup backlog нь хүртээмжид нөлөөлж болно. Автомат paid upgrade болон public bypass байхгүй.

Үүлэн account billing, domain ownership, Google OAuth тохиргоо, байгууллагын банк, үнэ/хугацааны шийдвэр, бүрэн медиа, хэрэглэгчийн мэдээлэл хадгалах бодлого нь эзэмшигчийн нээлтийн тохиргоонд хамаарна. Энэ review branch эдгээрийг зохиож бөглөөгүй.
