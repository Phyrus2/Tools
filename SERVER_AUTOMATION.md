# Otomatisasi perpindahan PC server

Script ini memakai Google Drive sebagai penyimpanan backup database. `server:down`
menutup tunnel dan backend, membuat dump MySQL, mengompresnya, menghitung SHA-256,
lalu mengunggah arsip dan `latest.json`. `server:up` mengambil kode serta backup
terbaru, memverifikasi checksum, merestore database bila diperlukan, menjalankan
Node.js dan TryCloudflare, memperbarui variable GitHub `API_URL`, lalu memicu
workflow GitHub Pages.

## Persiapan satu kali pada setiap PC  

Di Windows, GitHub CLI dan rclone dapat dipasang dari PowerShell:

```powershell
winget install --id Rclone.Rclone --exact --source winget
winget install --id GitHub.cli --exact --source winget
```

Tutup dan buka kembali PowerShell setelah instalasi agar PATH diperbarui. Jika
`winget` gagal, unduh arsip Windows dari situs resmi rclone dan halaman release
GitHub CLI, lalu isi `RCLONE_PATH` dan `GH_PATH` dengan lokasi file `.exe`.
Keduanya juga dapat disimpan secara portabel di folder `.server-tools`; folder ini
tidak ikut masuk ke GitHub.

1. Instal Node.js, Laragon, Git, GitHub CLI, dan rclone.
2. Jalankan `.\.server-tools\rclone.exe config`, buat remote Google Drive bernama
   `gdrive`, dan login
   ke akun Google yang sama pada kedua PC. Gunakan folder biasa di **My Drive**.
3. Jalankan `.\.server-tools\gh.exe auth login` dengan akun yang dapat mengubah
   Actions variables dan menjalankan workflow repository.
4. Pastikan `.env` lokal berisi konfigurasi berikut:

```dotenv
SERVER_ID=office
BACKUP_REMOTE=gdrive:C2I-Server-Backup
GITHUB_REPOSITORY=phyrus2/Tools
RCLONE_PATH=.server-tools/rclone.exe
GH_PATH=.server-tools/gh.exe
NODE_PATH=node.exe
NPM_PATH=npm.cmd
CLOUDFLARED_PATH=cloudflare/cloudflared.exe
MYSQL_PATH=
MYSQLDUMP_PATH=
MYSQL_SERVICE_NAME=
```

Pada PC rumah gunakan `SERVER_ID=home`. Skrip mendeteksi MySQL/MariaDB Laragon
secara otomatis dari drive `C:` atau `D:`. Untuk instalasi Laragon pada PC ini,
path yang ditemukan adalah:

```dotenv
MYSQL_PATH=C:\laragon\bin\mysql\mysql-8.4.3-winx64\bin\mysql.exe
MYSQLDUMP_PATH=C:\laragon\bin\mysql\mysql-8.4.3-winx64\bin\mysqldump.exe
```

Kedua nilai tersebut boleh dibiarkan kosong agar deteksi otomatis tetap bekerja
ketika versi MySQL Laragon berubah. Sebelum menjalankan script, buka Laragon lalu
tekan **Start All**. `MYSQL_SERVICE_NAME` tetap dikosongkan karena MySQL dijalankan
oleh Laragon.

Jika MySQL berupa Windows Service, isi nama service, misalnya:

```dotenv
MYSQL_SERVICE_NAME=MySQL80
```

Jangan menyalin `.env` atau `rclone.conf` ke GitHub. Autentikasi rclone dilakukan
terpisah pada masing-masing PC.

Periksa semua dependency tanpa restore, upload, atau deploy:

```powershell
npm run server:check
```

Jika pemeriksaan menyebut remote `gdrive` belum dibuat atau GitHub CLI belum
login, selesaikan langkah 2 atau 3 lalu jalankan pemeriksaan yang sama lagi.

## Pemakaian pertama

Jalankan `npm run server:up` pada PC yang memiliki database paling baru. Jika
folder Google Drive belum memiliki `latest.json`, script otomatis membuat dan
mengunggah backup awal dari database Laragon pada PC tersebut. Setelah itu PC
lain dapat mengambilnya otomatis.

## Menyalakan server

```powershell
npm run server:up
```

`server:up` menjalankan `git pull --ff-only` secara otomatis. Script kemudian:

1. Mengunduh `latest.json` dan arsip SQL terbaru dari Drive.
2. Memeriksa SHA-256 sebelum restore.
3. Tidak melakukan restore bila backup yang sama sudah digunakan dan penanda di
   dalam database masih cocok. Jika semua tabel terhapus, restore dijalankan ulang.
4. Menjalankan migrasi melalui startup `server.js`.
5. Menjalankan Node dan TryCloudflare sebagai proses tersembunyi.
6. Membaca URL `trycloudflare.com` dari log.
7. Menjalankan `gh variable set API_URL` dan `gh workflow run pages.yml`.

Log disimpan secara lokal di `.server-logs`. PID proses dan versi database disimpan
di `.server-state`; kedua folder sudah diabaikan Git.

## Mematikan dan memindahkan server

```powershell
npm run server:down
```

Tunggu sampai muncul `Server aman dimatikan atau dipindahkan ke PC lain`. Jangan
mematikan PC jika upload gagal. Script menghentikan tunnel terlebih dahulu supaya
tidak ada request baru selama backup terakhir dibuat.

Perintah `npm run db:backup` tetap tersedia untuk backup tambahan tanpa
menghentikan server, tetapi tidak diperlukan dalam alur normal:

```powershell
npm run db:backup
```

Opsi darurat berikut tersedia, tetapi jangan dipakai untuk perpindahan normal:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/server/start-server.ps1 -SkipRestore
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/server/start-server.ps1 -SkipDeploy
```

Restore mengganti database lokal dengan backup Drive yang telah diverifikasi. Jika
state lokal tercatat lebih baru daripada Drive, script membatalkan startup agar data
baru tidak tertimpa.
