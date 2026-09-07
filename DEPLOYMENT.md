# Backend di PC Windows, frontend di GitHub Pages

Alur koneksi: browser → GitHub Pages (Angular) → URL HTTPS backend → Cloudflare Tunnel → Express di PC → MySQL di PC.

## 0. Pastikan .env tidak ikut GitHub

`.env` sudah dilepas dari indeks Git tanpa menghapus file lokal. `.gitignore` mengabaikan `.env` dan `.env.*` di seluruh folder; `.env.example` tetap boleh diunggah karena hanya berisi contoh. Penghapusan dari pelacakan baru berlaku di GitHub setelah commit dan push.

Buka PowerShell di folder proyek:

```powershell
Set-Location 'C:\Users\pande\OneDrive\Documents\GitHub\Tools'
```

Jika `git` tidak dikenali, aktifkan Git bawaan GitHub Desktop untuk terminal ini:

```powershell
$desktopGit = Get-ChildItem "$env:LOCALAPPDATA\GitHubDesktop\app-*\resources\app\git\cmd\git.exe" |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $desktopGit) { throw 'Git tidak ditemukan. Instal Git for Windows atau gunakan GitHub Desktop.' }
$env:Path = "$($desktopGit.DirectoryName);$env:Path"
```

Periksa:

```powershell
git check-ignore -v .env
git ls-files -- .env
Test-Path .env
```

Perintah pertama harus menunjukkan aturan `.gitignore`, kedua tidak menghasilkan output, dan ketiga menghasilkan `True`. Status `D .env` berarti penghapusan dari repository sudah staged, bukan file lokal terhapus. Jangan memakai `git add -f .env`.

Jika mengulang di checkout lain yang masih melacak `.env`, jalankan `git rm --cached -- .env`. Jika `.env` pernah di-push, ganti password/secret tersebut dan perbarui `.env` lokal. Ignore dan commit penghapusan tidak membersihkan riwayat lama.

## 1. Jalankan backend

Gunakan Node.js 24 dan MySQL. Dari folder utama proyek:

```powershell
npm ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
```

Isi kredensial MySQL di `.env` sebelum menjalankan server. Server menjalankan migrasi database saat startup. Periksa `http://localhost:3000/`: harus mengembalikan JSON sukses.

Contoh isi (sesuaikan dengan database lokal, jangan mengganti nilai yang sudah benar):

```dotenv
PORT=3000
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=tools_app
DB_PASSWORD=PASSWORD_MYSQL_KAMU
DB_NAME=tools
CORS_ORIGINS=http://localhost:4200,https://YOUR_USERNAME.github.io
TRUST_CLOUDFLARE_IP_HEADER=true
```

User database harus sudah dibuat dan punya izin pada database aplikasi, termasuk untuk migrasi. Jika memakai XAMPP, nyalakan MySQL melalui XAMPP Control Panel. Jika memakai Windows Service, cari nama service di PowerShell:

```powershell
Get-Service -Name '*mysql*','*maria*' -ErrorAction SilentlyContinue
```

Untuk service yang berhenti, jalankan PowerShell sebagai Administrator lalu `Start-Service -Name MySQL80` (ganti `MySQL80` dengan nama service yang ditemukan). Jika daftar kosong, gunakan pengelola MySQL yang kamu instal; jangan menganggap MySQL sudah berjalan.

Di terminal pertama, dari root proyek:

```powershell
npm run admin:create
npm start
```

Perintah `admin:create` menjalankan migrasi keamanan lalu meminta username, nama, dan password admin. Password harus 14-128 karakter, tidak ditampilkan saat diketik, dan disimpan sebagai hash scrypt dengan salt acak. Jalankan perintah yang sama untuk mengganti password admin; semua sesi login lama akan otomatis dicabut. Akun lama `admin/admin123` tidak lagi dapat dipakai.

Biarkan terminal ini terbuka. Di terminal lain, periksa:

```powershell
Invoke-RestMethod http://localhost:3000/health
```

Atur origin frontend di `.env`, lalu restart backend:

```dotenv
CORS_ORIGINS=http://localhost:4200,https://YOUR_USERNAME.github.io
```

Untuk situs `https://YOUR_USERNAME.github.io/Tools/`, origin tetap `https://YOUR_USERNAME.github.io` tanpa path dan tanpa slash terakhir. Jika memakai custom domain, gunakan origin domain tersebut.

## 2. Siapkan akses HTTPS ke PC

Untuk alamat tetap, buat Cloudflare Tunnel dengan domain yang dikelola Cloudflare. Pada published application route, arahkan hostname seperti `api.example.com` ke service `http://localhost:3000`. Jalankan connector Windows sesuai instruksi dashboard Cloudflare. File `cloudflare/cloudflared.exe` sudah tersedia di workspace lokal ini.

Panduan resmi: https://developers.cloudflare.com/tunnel/setup/

Tunnel menyediakan akses ke service lokal tanpa membuka port router. Jangan membuka port MySQL 3306 ke internet.

Endpoint data sekarang dilindungi login admin. Tetap jangan menaruh password database, token sesi, atau secret API di frontend maupun repository GitHub.

Untuk uji sementara dengan data dummy, setelah memahami akses publik tersebut, jalankan di terminal kedua dari root proyek:

```powershell
.\cloudflare\cloudflared.exe tunnel --url http://localhost:3000
```

Gunakan URL HTTPS `trycloudflare.com` yang ditampilkan. URL sementara berubah saat tunnel dibuat ulang, sehingga `API_URL` perlu diperbarui dan frontend dideploy ulang. Backend dan tunnel harus tetap berjalan.

Tes URL yang keluar, ganti contoh berikut dengan URL kamu:

```powershell
Invoke-RestMethod https://NAMA-ACAK.trycloudflare.com/health
```

Quick Tunnel hanya untuk pengujian, bukan server produksi. Untuk pemakaian rutin dengan URL tetap, gunakan domain di Cloudflare dan named tunnel. Dari root proyek:

```powershell
.\cloudflare\cloudflared.exe tunnel login
.\cloudflare\cloudflared.exe tunnel create tools-backend
.\cloudflare\cloudflared.exe tunnel route dns tools-backend api.DOMAIN_KAMU.com
notepad "$env:USERPROFILE\.cloudflared\tools-backend.yml"
```

Login melalui browser yang terbuka, pilih domain, lalu isi file YAML menggunakan UUID dari hasil `tunnel create` dan path credentials JSON yang ditampilkan:

```yaml
tunnel: UUID_TUNNEL_KAMU
credentials-file: C:/Users/pande/.cloudflared/UUID_TUNNEL_KAMU.json
ingress:
  - hostname: api.DOMAIN_KAMU.com
    service: http://localhost:3000
  - service: http_status:404
```

Jalankan tunnel ini sebagai pengganti Quick Tunnel:

```powershell
.\cloudflare\cloudflared.exe tunnel --config "$env:USERPROFILE\.cloudflared\tools-backend.yml" run tools-backend
```

Untuk named tunnel, nilai `API_URL` menjadi `https://api.DOMAIN_KAMU.com`. File credentials dan sertifikat login harus tetap lokal. Panduan resmi: https://developers.cloudflare.com/tunnel/advanced/local-management/create-local-tunnel/

## 3. Deploy frontend

1. Commit dan push konfigurasi memakai perintah di bawah. Pastikan `.env`, kredensial tunnel, dan data upload tidak ikut sebagai file baru/diubah; `D .env` justru diperlukan untuk menghapus versi repository.
2. Di repository, buka **Settings → Pages → Source → GitHub Actions**.
3. Buka **Settings → Secrets and variables → Actions → Variables**. Tambahkan repository variable `API_URL` dengan URL HTTPS backend, misalnya `https://api.example.com` (bukan URL frontend).
4. Buka **Actions → Deploy frontend to GitHub Pages → Run workflow** pada branch yang berisi konfigurasi ini.
5. Setelah selesai, buka URL dari hasil deployment. Coba pencarian data untuk memverifikasi koneksi API.

Perintah commit dan push dari root proyek (perintah ini memilih file konfigurasi deployment; perubahan fitur lain bisa di-commit terpisah):

```powershell
git status --short
git add .gitignore .env.example DEPLOYMENT.md .github/workflows/pages.yml package.json server.js Security scripts Database/migrations frontend/src/app frontend/src/index.html frontend/public/api-config.js frontend/scripts/configure-pages.mjs Controller/data_analyst/excel
git diff --cached --name-status
git commit -m "Prepare PC backend and GitHub Pages deployment; stop tracking env"
git push origin main
```

Perintah push mengasumsikan branch `main`; cek dengan `git branch --show-current`. Workflow harus sudah ada di default branch agar tombol `Run workflow` tersedia. Jika memakai branch lain, merge ke default branch melalui alur repository kamu.

Tidak perlu mengunggah folder `dist` secara manual atau menjalankan `ng deploy`. Workflow akan menginstal dependency frontend, membangun Angular, dan menerbitkan hasilnya. Setelah perubahan berikutnya di-push, jalankan `Run workflow` lagi karena workflow ini tidak otomatis dipicu oleh push.

Workflow hanya berjalan manual. Workflow membangun folder `frontend`, menyesuaikan base path Pages, lalu mengunggah hanya `frontend/dist/frontend/browser`. Backend dan `.env` tidak menjadi bagian artifact. `API_URL` wajib HTTPS; konfigurasi yang kosong/tidak valid menggagalkan deployment.

Routing Angular menggunakan hash, misalnya `/Tools/#/...`, supaya refresh halaman tidak memerlukan rewrite server di GitHub Pages. Pengembangan lokal tetap memakai `http://localhost:3000` dari `frontend/public/api-config.js`.

Panduan workflow resmi: https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages

## 4. Operasional PC

PC harus menyala, tersambung internet, dan tidak sleep selama backend dibutuhkan. Atur MySQL, backend, dan connector tunnel agar berjalan otomatis saat Windows menyala (Windows Service atau Task Scheduler, dengan working directory root proyek untuk backend). Konfigurasi autostart belum dipasang oleh perubahan ini. Jika PC mati, halaman Pages tetap terbuka tetapi operasi data gagal. Backup database secara berkala.

Jika koneksi gagal, periksa JSON di URL publik backend, proses MySQL/Express/tunnel, nilai `API_URL` dalam `api-config.js` pada situs Pages, dan kecocokan `CORS_ORIGINS`. URL `localhost` pada browser pengunjung menunjuk perangkat pengunjung, bukan PC server.

## 5. Keamanan login admin

Semua endpoint supplier, product, booked product, dan pencarian membutuhkan sesi admin. Hanya `/health` dan `/auth/login` yang dapat diakses tanpa login. Sesi memakai token acak 256-bit, token asli hanya berada di tab browser, database menyimpan SHA-256 token, dan sesi habis setelah 8 jam. Menutup tab menghapus token dari browser. Lima kegagalan pada username yang sama mengunci akun selama 15 menit; backend juga membatasi percobaan per alamat IP dan jumlah pemeriksaan password bersamaan.

Password memakai scrypt dengan konfigurasi memory-hard. Respons gagal login tidak mengungkap apakah username ada. Upload dibatasi 10 MB dan satu file per request. Backend menolak origin browser di luar `CORS_ORIGINS` dan mengirim header keamanan dasar.

Set `TRUST_CLOUDFLARE_IP_HEADER=true` hanya jika port 3000 tidak dibuka ke jaringan/internet dan backend hanya dipublikasikan melalui Cloudflare Tunnel. Jika port backend juga dapat diakses langsung oleh perangkat lain, set `false` agar header IP tidak dapat dipalsukan.

Login melindungi aplikasi, tetapi tidak membuat PC kebal serangan. Gunakan named tunnel, jangan port-forward 3000 atau 3306, aktifkan update Windows/Node/MySQL, gunakan password admin unik dari password manager, dan backup database. Untuk tingkat perlindungan lebih tinggi, langkah berikutnya adalah MFA atau Cloudflare Access di depan hostname API.
