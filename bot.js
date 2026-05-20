require('dotenv').config();
const { Telegraf, session, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Inisialisasi session default
bot.use(session({ defaultSession: () => ({ state: null, currentJobId: null }) }));

// Fungsi generate Ref No unik
const generateRef = (prefix) => `${prefix}-${Math.random().toString(36).substring(2, 8).toUpperCase()}${Date.now().toString().slice(-4)}`;

// ==========================================
// ⚙️ PENGATURAN FORCE JOIN (WAJIB GABUNG)
// ==========================================
const CHANNEL_USERNAME = '@posttaskch'; 
const GROUP_USERNAME = '@posttaxk';      
const CHANNEL_LINK = 'https://t.me/posttaskch'; 
const GROUP_LINK = 'https://t.me/posttaxk';      

const checkMembership = async (ctx, userId) => {
    try {
        const resChannel = await ctx.telegram.getChatMember(CHANNEL_USERNAME, userId);
        const resGroup = await ctx.telegram.getChatMember(GROUP_USERNAME, userId);
        const validStatuses = ['creator', 'administrator', 'member', 'restricted'];
        return validStatuses.includes(resChannel.status) && validStatuses.includes(resGroup.status);
    } catch (error) {
        return false;
    }
};

const mainMenu = Markup.inlineKeyboard([
    [Markup.button.callback('🚀 MULAI TUGAS', 'menu_job')],
    [Markup.button.callback('💰 SALDO SAYA', 'menu_saldo'), Markup.button.callback('💳 TARIK DANA', 'menu_wd')],
    [Markup.button.callback('📊 RIWAYAT TUGAS', 'history_job'), Markup.button.callback('💸 RIWAYAT WD', 'history_wd')]
]);

const backMenu = Markup.inlineKeyboard([
    [Markup.button.callback('🔙 KEMBALI KE BERANDA', 'back_to_start')]
]);

const cancelInputMenu = Markup.inlineKeyboard([
    [Markup.button.callback('❌ BATALKAN', 'cancel_action')]
]);

const getHomeText = (username) => 
    `🏢 <b>MEMBER AREA DASHBOARD</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `Halo, <b>${username}</b>! 👋\n` +
    `Selamat datang di platform micro-tasking. Ubah waktu luangmu menjadi penghasilan nyata hanya dengan memposting konten!\n\n` +
    `📈 <b>RATE PENGHASILAN:</b>\n` +
    `🔹 Rp 800 - Rp 1.500 / Postingan\n\n` +
    `<i>Pilih menu di bawah ini untuk mengelola akun atau memulai tugas harianmu.</i>`;

bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username || ctx.from.first_name || 'User';
    ctx.session.state = null;

    const isMember = await checkMembership(ctx, userId);
    if (!isMember) {
        const joinMenu = Markup.inlineKeyboard([
            [Markup.button.url('📢 GABUNG CHANNEL', CHANNEL_LINK)],
            [Markup.button.url('💬 GABUNG GRUP', GROUP_LINK)],
            [Markup.button.callback('✅ SAYA SUDAH GABUNG', 'verify_join')]
        ]);
        return ctx.reply(`⚠️ <b>AKSES DITOLAK</b>\n━━━━━━━━━━━━━━━━━━━━\nHarap bergabung ke Channel dan Grup untuk akses bot.`, { parse_mode: 'HTML', ...joinMenu });
    }

    await supabase.from('users').upsert({ id: userId, username: username }, { onConflict: 'id' });
    ctx.reply(getHomeText(username), { parse_mode: 'HTML', ...mainMenu });
});

bot.action('verify_join', async (ctx) => {
    const isMember = await checkMembership(ctx, ctx.from.id);
    if (!isMember) return ctx.answerCbQuery('❌ Belum gabung!', { show_alert: true });
    
    const username = ctx.from.username || ctx.from.first_name || 'User';
    await supabase.from('users').upsert({ id: ctx.from.id, username: username }, { onConflict: 'id' });
    await ctx.editMessageText(getHomeText(username), { parse_mode: 'HTML', ...mainMenu }).catch(() => {});
});

bot.action('back_to_start', async (ctx) => {
    ctx.session.state = null;
    const username = ctx.from.username || ctx.from.first_name || 'User';
    await ctx.editMessageText(getHomeText(username), { parse_mode: 'HTML', ...mainMenu }).catch(() => {});
});

bot.action('cancel_action', async (ctx) => {
    ctx.session.state = null;
    const username = ctx.from.username || ctx.from.first_name || 'User';
    await ctx.editMessageText(getHomeText(username), { parse_mode: 'HTML', ...mainMenu }).catch(() => {});
});

bot.action('menu_job', async (ctx) => {
    try {
        const userId = ctx.from.id;

        const { data: user } = await supabase.from('users').select('last_job_at').eq('id', userId).single();
        if (user && user.last_job_at) {
            const lastTime = new Date(user.last_job_at);
            const diffMinutes = Math.floor((new Date() - lastTime) / 1000 / 60);

            if (diffMinutes < 1) {
                return ctx.answerCbQuery(`⏳ COOLDOWN AKTIF!\n\nSistem membatasi kecepatan. Silakan coba lagi dalam ${1 - diffMinutes} menit untuk mengambil misi baru.`, { show_alert: true });
            }
        }

        // ==========================================
        // 🛑 LOGIKA BARU: CEK BATAS 10 TUGAS PER HARI
        // ==========================================
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const { data: todayJobs } = await supabase.from('user_jobs')
            .select('status')
            .eq('user_id', userId)
            .gte('created_at', startOfDay.toISOString());

        if (todayJobs) {
            // Hitung tugas yang statusnya approved atau pending hari ini
            const activeJobsToday = todayJobs.filter(j => j.status === 'approved' || j.status === 'pending').length;
            
            if (activeJobsToday >= 10) {
                return ctx.answerCbQuery(`❌ BATAS HARIAN TERCAPAI!\n\nKamu sudah mencapai batas maksimal 10 tugas (Disetujui/Pending) hari ini. Silakan kembali besok!`, { show_alert: true });
            }
        }
        // ==========================================

        const { data: jobs } = await supabase.from('jobs').select('*').eq('is_active', true).gt('quota', 0);
        if (!jobs || jobs.length === 0) {
            return ctx.answerCbQuery(`📭 YAH, KOSONG!\n\nSaat ini belum ada tugas baru atau kuota telah habis ditebas user lain. Cek lagi nanti ya!`, { show_alert: true });
        }

        const randomJob = jobs[Math.floor(Math.random() * jobs.length)];

        ctx.session.state = 'WAITING_FOR_LINK';
        ctx.session.currentJobId = randomJob.id;

        const jobText = 
            `📋 <b>MISI BARU TERSEDIA!</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `💰 <b>Reward:</b> Rp ${randomJob.reward}\n` +
            `👥 <b>Sisa Kuota:</b> ${randomJob.quota}/1000\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `<b>Instruksi, Syarat & Ketentuan:</b>\n` +
            `1️⃣ Ketuk caption di bawah ini untuk menyalin otomatis.\n` +
            `2️⃣ Posting teks tersebut di grup JB NOKOS/OTP atau semacamnya.\n` +
            `3️⃣ Minimal group members: <b>1k Members</b>.\n` +
            `4️⃣ Dilarang memposting POST TUGAS yang sama di GRUP yang sama.\n` +
            `5️⃣ Dilarang mengirimkan link yang sama <b>(langsung BANNED!).</b>\n` +
            `6️⃣ Balas pesan ini dengan <b>Link Postingan</b> sebagai bukti.\n\n` +
            
            `📝 <b>CAPTION (TAP KOTAK DI BAWAH UNTUK COPY):</b>\n` +
            `<blockquote><pre>${randomJob.caption}</pre></blockquote>\n\n` +
            
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `💡 <b>Catatan Tambahan:</b>\n` +
            `• Boleh menggunakan link referral kamu sendiri.\n` +
            `• Daftar di https://flashotp.shop/ untuk dapatkan referral kamu, copy lalu edit caption pada bagian <b>Link Nokos : </b> ganti dengan referral kamu.\n`;

        // LOGIKA BARU: KIRIM TEKS DULU, BARU FOTO
        if (randomJob.image_url) {
            await ctx.deleteMessage().catch(() => {});
            
            // Tambahkan instruksi untuk download foto
            const textWithImageNote = jobText + `\n⬇️ <b>SILAKAN DOWNLOAD FOTO DI BAWAH INI UNTUK DIPOSTING JUGA</b> ⬇️`;
            
            // Kirim teks dulu tanpa tombol
            await ctx.reply(textWithImageNote, { parse_mode: 'HTML' });
            
            // Kirim foto setelah teks, letakkan tombol BATAL di bawah foto
            await ctx.replyWithPhoto({ url: randomJob.image_url }, { ...cancelInputMenu }).catch(() => {});
        } else {
            // Jika tidak ada foto, tampilkan seperti biasa
            await ctx.editMessageText(jobText, { parse_mode: 'HTML', ...cancelInputMenu }).catch(() => {});
        }
        
        ctx.answerCbQuery('Misi berhasil didapatkan!');
    } catch (error) {
        ctx.answerCbQuery('Terjadi kesalahan sistem.', { show_alert: true });
    }
});

bot.action('menu_saldo', async (ctx) => {
    const { data: user } = await supabase.from('users').select('balance, payment_info').eq('id', ctx.from.id).single();
    const text = 
        `💳 <b>DOMPET DIGITAL</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `💰 <b>Saldo Tersedia:</b> Rp ${user.balance.toLocaleString('id-ID')}\n` +
        `🏦 <b>Info E-Wallet:</b> <code>${user.payment_info || 'Belum diatur'}</code>\n\n` +
        `<i>Pastikan E-Wallet Anda sudah benar sebelum melakukan penarikan dana.</i>`;
    await ctx.editMessageText(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('✏️ Ubah E-Wallet', 'edit_ewallet')], [Markup.button.callback('🔙 Kembali', 'back_to_start')]]) });
});

bot.action('edit_ewallet', async (ctx) => {
    ctx.session.state = 'WAITING_FOR_EWALLET';
    const text = 
        `🏦 <b>PENGATURAN E-WALLET</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `Silakan balas pesan ini dengan format E-Wallet yang baru.\n\n` +
        `Contoh Format: <code>DANA 081234567890 NAMA</code>`;
    
    await ctx.editMessageText(text, { parse_mode: 'HTML', ...cancelInputMenu }).catch(() => {});
    ctx.answerCbQuery();
});

bot.action('menu_wd', async (ctx) => {
    const userId = ctx.from.id;
    const { data: pendingWD } = await supabase.from('withdrawals').select('id').eq('user_id', userId).eq('status', 'pending');
    if (pendingWD?.length > 0) return ctx.answerCbQuery(`⚠️ Ada WD pending!`, { show_alert: true });

    const { data: user } = await supabase.from('users').select('balance, payment_info').eq('id', userId).single();
    if (!user.payment_info) {
        ctx.session.state = 'WAITING_FOR_EWALLET';
        const text = `⚠️ <b>E-WALLET BELUM DIATUR</b>\n━━━━━━━━━━━━━━━━━━━━\nSebelum menarik dana, balas pesan ini dengan nomor E-Wallet kamu.\n\nContoh: <code>DANA 081234567890 NAMA</code>`;
        await ctx.editMessageText(text, { parse_mode: 'HTML', ...cancelInputMenu }).catch(() => {});
        return ctx.answerCbQuery();
    }
    if (user.balance < 6000) return ctx.answerCbQuery(`❌ Saldo min Rp 6.000`, { show_alert: true });

    const wdKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback('💵 WD 5K (Saldo -6K)', 'process_wd_5000')],
        [Markup.button.callback('💵 WD 10K (Saldo -11K)', 'process_wd_10000')],
        [Markup.button.callback('💵 WD 20K (Saldo -21K)', 'process_wd_20000')],
        [Markup.button.callback('💵 WD 30K (Saldo -31K)', 'process_wd_30000')],
        [Markup.button.callback('💵 WD 40K (Saldo -41K)', 'process_wd_40000')],
        [Markup.button.callback('💵 WD 50K (Saldo -51K)', 'process_wd_50000')],
        [Markup.button.callback('💵 WD 100K (Saldo -101K)', 'process_wd_100000')],
        [Markup.button.callback('❌ BATALKAN', 'cancel_action')]
    ]);

    const text = 
        `💸 <b>PENARIKAN DANA</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `💰 <b>Saldo Tersedia:</b> Rp ${user.balance.toLocaleString('id-ID')}\n` +
        `🏦 <b>Tujuan:</b> <code>${user.payment_info}</code>\n\n` +
        `⚠️ <i>Terdapat <b>Biaya Admin Rp 1.000</b> untuk seluruh jenis E-Wallet. Saldo akan dipotong sesuai nominal di tombol.</i>\n\n` +
        `Pilih nominal penarikan di bawah ini:`;
        
    await ctx.editMessageText(text, { parse_mode: 'HTML', ...wdKeyboard }).catch(() => {});
    ctx.answerCbQuery();
});

bot.action(/^process_wd_(\d+)$/, async (ctx) => {
    try {
        const netAmount = parseInt(ctx.match[1]); // Contoh: 5000
        const totalDeduction = netAmount + 1000;  // Contoh: 6000 (Potongan asli)
        const userId = ctx.from.id;

        // VALIDASI DOUBLE WD PENDING (KEAMANAN)
        const { data: checkPending } = await supabase.from('withdrawals').select('id').eq('user_id', userId).eq('status', 'pending');
        if (checkPending && checkPending.length > 0) {
            return ctx.answerCbQuery(`⚠️ GAGAL!\n\nSelesaikan dulu WD yang masih pending.`, { show_alert: true });
        }

        const { data: user } = await supabase.from('users').select('balance').eq('id', userId).single();

        // Validasi lagi untuk mencegah klik berulang atau eksploitasi
        if (user.balance < totalDeduction) {
            return ctx.answerCbQuery(`❌ SALDO TIDAK CUKUP!\n\nButuh Rp ${totalDeduction.toLocaleString('id-ID')} untuk menarik nominal ini.`, { show_alert: true });
        }

        const refNo = generateRef('WD');

        // Update saldo & Insert riwayat
        await supabase.from('users').update({ balance: user.balance - totalDeduction }).eq('id', userId);
        await supabase.from('withdrawals').insert({ user_id: userId, amount: netAmount, ref_no: refNo, status: 'pending' });

        const successText = 
            `🚀 <b>PENARIKAN DIPROSES!</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `🆔 <b>No. Ref:</b> <code>${refNo}</code>\n` +
            `💵 <b>Diterima:</b> Rp ${netAmount.toLocaleString('id-ID')}\n` +
            `📉 <b>Total Saldo Terpotong:</b> Rp ${totalDeduction.toLocaleString('id-ID')}\n` +
            `⏳ <b>Status:</b> Menunggu Proses Admin\n\n` +

            `<i>Permintaan Anda sedang dalam antrean.</i>`;

        await ctx.editMessageText(successText, { parse_mode: 'HTML', ...backMenu }).catch(() => {});
        ctx.answerCbQuery('Request WD Terkirim!');
    } catch (error) {
        console.error(error);
        ctx.answerCbQuery('Terjadi kesalahan saat memproses WD.', { show_alert: true });
    }
});

// MENU: RIWAYAT TUGAS (DENGAN ALASAN REJECT)
bot.action('history_job', async (ctx) => {
    const { data: jobs } = await supabase.from('user_jobs').select('*').eq('user_id', ctx.from.id).order('created_at', { ascending: false }).limit(5);
    let text = `📊 <b>RIWAYAT TUGAS</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
    if (!jobs?.length) text += `<i>Kosong</i>`;
    else jobs.forEach(j => {
        const icon = j.status === 'approved' ? '✅' : j.status === 'rejected' ? '❌' : '⏳';
        text += `${icon} <code>${j.ref_no}</code> | <b>${j.status.toUpperCase()}</b>\n`;
        if (j.status === 'rejected' && j.rejection_reason) text += `└ Alasan: <i>${j.rejection_reason}</i>\n`;
    });
    await ctx.editMessageText(text, { parse_mode: 'HTML', ...backMenu });
});

// MENU: RIWAYAT WD (DENGAN ALASAN REJECT)
bot.action('history_wd', async (ctx) => {
    const { data: wds } = await supabase.from('withdrawals').select('*').eq('user_id', ctx.from.id).order('created_at', { ascending: false }).limit(5);
    let text = `💸 <b>RIWAYAT WD</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
    if (!wds?.length) text += `<i>Kosong</i>`;
    else wds.forEach(w => {
        const icon = w.status === 'approved' ? '✅' : w.status === 'rejected' ? '❌' : '⏳';
        text += `${icon} <code>${w.ref_no}</code> | Rp ${w.amount} | <b>${w.status.toUpperCase()}</b>\n`;
        if (w.status === 'rejected' && w.rejection_reason) text += `└ Alasan: <i>${w.rejection_reason}</i>\n`;
    });
    await ctx.editMessageText(text, { parse_mode: 'HTML', ...backMenu });
});

bot.on('text', async (ctx) => {
    const state = ctx.session?.state;
    const userId = ctx.from.id;
    if (state === 'WAITING_FOR_LINK') {
        const submittedLink = ctx.message.text;

        // CEK APAKAH LINK SUDAH PERNAH DIKIRIM SEBELUMNYA (ANTI DUPLIKAT)
        const { data: existingLink } = await supabase.from('user_jobs').select('id').eq('post_link', submittedLink).limit(1);
        
        if (existingLink && existingLink.length > 0) {
            ctx.session.state = null; // Reset state agar tidak ngebug
            return ctx.reply(
                `❌ <b>SUBMISSION DITOLAKAN: LINK SUDAH DIGUNAKAN!</b>\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `Link postingan yang kamu kirimkan sudah pernah disubmit sebelumnya di sistem kami.\n\n` +
                `Dilarang keras mengirimkan link bukti yang sama (Copy Paste). Silakan ambil tugas kembali dan gunakan link postingan yang benar-benar baru.`, 
                { parse_mode: 'HTML', ...backMenu }
            );
        }

        const refNo = generateRef('JOB');
        const { data: job } = await supabase.from('jobs').select('quota').eq('id', ctx.session.currentJobId).single();
        if (job.quota <= 0) return ctx.reply('⚠️ <b>MAAF<b> Belum ada Job tersedia!');
        await supabase.from('user_jobs').insert({ user_id: userId, job_id: ctx.session.currentJobId, post_link: submittedLink, ref_no: refNo });
        await supabase.from('jobs').update({ quota: job.quota - 1 }).eq('id', ctx.session.currentJobId);
        await supabase.from('users').update({ last_job_at: new Date().toISOString() }).eq('id', userId);
        ctx.session.state = null;
        ctx.reply(`✅ <b>BUKTI DITERIMA!</b>\n━━━━━━━━━━━━━━━━━━━━\nNo. Ref: <code>${refNo}</code>\n\nTugas berhasil disubmit. Silakan tunggu admin memvalidasi tautan Anda.`, { parse_mode: 'HTML', ...backMenu });
    } else if (state === 'WAITING_FOR_EWALLET') {
        await supabase.from('users').update({ payment_info: ctx.message.text }).eq('id', userId);
        ctx.session.state = null;
        ctx.reply(`✅ <b>BERHASIL!</b>\n\nInfo E-Wallet telah diperbarui menjadi:\n<code>${ctx.message.text}</code>`, { parse_mode: 'HTML', ...backMenu });
    }
});

const express = require('express');
const app = express();

app.use(express.json());

app.get('/', (req, res) => {
    res.send('Bot aktif 🚀');
});

app.post('/webhook', async (req, res) => {
    try {
        await bot.handleUpdate(req.body);
        res.sendStatus(200);
    } catch (e) {
        console.error(e);
        res.sendStatus(500);
    }
});

module.exports = app;

console.log('🚀 Bot Running...');
