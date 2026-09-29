# Otomatisasi perpindahan PC server

Script ini memakai Google Drive sebagai penyimpanan backup database. Selama server
aktif, worker membuat backup otomatis setiap 60 menit. `server:down` menghentikan
worker, menutup tunnel dan backend, lalu tetap membuat backup final. Setiap backup
membuat dump MySQL, mengompresnya, menghitung SHA-256, lalu mengunggah arsip dan
`latest.json`. `server:up` mengambil kode serta backup terbaru, memverifikasi
checksum, merestore database bila diperlukan, menjalankan Node.js dan TryCloudflare,
memperbarui variable GitHub `API_URL`, lalu memicu workflow GitHub Pages.

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
BACKUP_INTERVAL_MINUTES=60
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

Pada PC baru, setelah rclone dan GitHub CLI dipasang, langkah 2 dan 3 juga dapat
dijalankan melalui satu perintah yang mencari instalasi WinGet secara otomatis:

```powershell
npm run server:setup
```

Jika perintah `rclone` belum dikenali setelah instalasi WinGet, tutup lalu buka
PowerShell atau langsung gunakan `server:setup`; script tidak bergantung pada PATH.

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
8. Menunggu workflow selesai dan memastikan `api-config.js` publik sudah memakai
   URL tunnel terbaru sebelum menyatakan frontend siap digunakan.
9. Menjalankan worker backup otomatis sesuai `BACKUP_INTERVAL_MINUTES`.

Log disimpan secara lokal di `.server-logs`. PID proses dan versi database disimpan
di `.server-state`; kedua folder sudah diabaikan Git.

## Mematikan dan memindahkan server

```powershell
npm run server:down
```

Tunggu sampai muncul `Server aman dimatikan atau dipindahkan ke PC lain`. Jangan
mematikan PC jika upload gagal. Script menghentikan tunnel terlebih dahulu supaya
tidak ada request baru selama backup terakhir dibuat.

Log backup otomatis tersedia di `.server-logs/backup-worker.out.log` dan
`.server-logs/backup-worker.err.log`. Jika satu jadwal gagal, worker tetap hidup
dan mencoba lagi pada jadwal berikutnya. Backup yang berjalan bersamaan akan
diserialkan agar tidak saling menimpa.

Perintah `npm run db:backup` tetap tersedia untuk backup tambahan tanpa
menghentikan server:

```powershell
npm run db:backup
```

Backup terbaru juga dapat diambil dari Google Drive tanpa menjalankan backend,
tunnel, atau worker backup. Untuk hanya mengunduh dan memverifikasi arsip:

```powershell
npm run db:backup:download
```

Arsip disimpan di `.server-backups\downloads`. Untuk mengunduh lalu merestore
database lokal tanpa menjalankan server:

```powershell
npm run db:restore
```

Restore akan ditolak jika server/worker masih aktif, checksum tidak cocok, nama
database berbeda, atau database lokal tercatat lebih baru daripada backup Drive.
Opsi darurat `-Force` tersedia dengan menjalankan script PowerShell secara langsung,
tetapi akan menimpa database lokal:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/server/restore-database.ps1 -Force
```

Opsi darurat berikut tersedia, tetapi jangan dipakai untuk perpindahan normal:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/server/start-server.ps1 -SkipRestore
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/server/start-server.ps1 -SkipDeploy
```

Restore mengganti database lokal dengan backup Drive yang telah diverifikasi. Jika
state lokal tercatat lebih baru daripada Drive, script membatalkan startup agar data
baru tidak tertimpa.

## Otomatis hidup kembali setelah restart atau listrik padam

Autostart memakai Windows Task Scheduler dengan trigger **At startup** dan berjalan
memakai password akun Windows. Karena itu server mulai sebelum ada orang yang login;
PIN Windows Hello tidak dapat dipakai sebagai password task. Watchdog memeriksa proses
Node, Cloudflare, worker backup, dan endpoint `/health`. Jika salah satunya gagal,
watchdog menjalankan shutdown/backup lalu mencoba `server:up` lagi dengan jeda bertahap.

Database wajib berjalan sebagai Windows Service. Jika `MYSQL_SERVICE_NAME` masih kosong,
installer akan mendeteksi service yang sudah ada atau mendaftarkan MySQL Laragon sebagai
`C2IToolsMySQL`. Jika MySQL sedang berjalan manual dari Laragon, lakukan **Stop All** dan
tutup Laragon sebelum instalasi. Nama service juga boleh diisi sendiri di `.env`, misalnya:

```dotenv
MYSQL_SERVICE_NAME=MySQL80
```

Buka PowerShell dengan **Run as administrator** di root project lalu jalankan:

```powershell
npm run server:autostart:install
```

Instalasi mengatur database service menjadi Automatic, membuat task dengan delay satu
menit setelah boot, menonaktifkan sleep/hibernate ketika PC memakai listrik AC, dan
langsung memulai task. Periksa hasilnya dengan:

```powershell
npm run server:autostart:status
Get-Content .server-logs\watchdog.log -Tail 100
```

Untuk maintenance, gunakan perintah berikut agar watchdog tidak langsung menyalakan
server yang baru dihentikan:

```powershell
npm run server:autostart:stop
npm run server:autostart:start
```

`server:autostart:stop` hanya berlaku sampai boot berikutnya. Untuk menghapus task:

```powershell
npm run server:autostart:uninstall
```

Jika password akun Windows berubah, jalankan `server:autostart:install` lagi agar
kredensial task diperbarui. Project, `.env`, tool portabel, dan konfigurasi autentikasi
harus tersedia secara lokal; jangan jadikan file-file tersebut online-only di OneDrive.

Terakhir, buka BIOS/UEFI PC dan aktifkan opsi yang biasanya bernama **Restore on AC
Power Loss**, **After Power Failure**, atau **AC Back** lalu pilih **Power On**. Ini tidak
dapat diatur secara universal dari Windows. Tanpa opsi BIOS tersebut, autostart Windows
akan bekerja setelah restart, tetapi PC tidak bisa menyalakan dirinya sendiri setelah
listrik padam total. UPS tetap disarankan karena software tidak dapat membuat backup
saat daya hilang mendadak.
