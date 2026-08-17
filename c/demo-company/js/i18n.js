/* GATA Cloud Uploader - UI languages (English / العربية / Türkçe).
 * The technical log always stays in English (it is meant for support).
 */
"use strict";

const I18N = {
  lang: "en",

  strings: {
    /* ------------------------------------------------------------ English */
    en: {
      "app.title": "GATA Firmware Updater",
      "app.subtitle": "Cloud firmware update over USB",
      "banner.demo": "DEMO MODE — no real device is used. Turn it off under Settings.",

      "s1.title": "Choose the software",
      "badge.cloud": "cloud",
      "badge.local": "uploader folder",
      "btn.refresh": "Refresh list",
      "btn.useLocal": "Use the files in the uploader folder",
      "btn.useCloud": "Back to cloud versions",
      "local.hint": "Files found in the main_firmware and cloud_firmware folders inside the uploader:",
      "local.rescan": "Scan again",
      "local.sys": "System firmware",
      "local.main": "Controller software",
      "local.esp": "Cloud module (ESP32)",
      "local.missing": "not found",
      "local.espComplete": "complete (4 files)",
      "local.espFwOnly": "firmware.bin only (needs an already-programmed ESP32)",
      "local.noMain": "No controller software (M*.bin) found in the main_firmware folder.",
      "local.noBoot": "B1.bin / B3.bin not found in the main_firmware folder.",
      "local.hintFiles": "Put the files inside the uploader folder like this: main_firmware\\B1.bin, B3.bin and M*.bin — cloud_firmware\\bootloader.bin, partitions.bin, boot_app0.bin, firmware.bin. Then press “Scan again”.",
      "local.oldServer": "The folder contents could not be listed — the local server running is an old version. Close its black window, double-click CLICK_ME_START_ON_PC.bat again, then press “Scan again”.",
      "opt": "(optional)",

      "s2.title": "Prepare the controller",
      "prep.1.pc": "Connect the controller to this computer with a USB cable.",
      "prep.1.phone": "Connect the controller to this phone with a USB-OTG adapter.",
      "prep.2": "Press and <b>hold the BOOT button</b>.",
      "prep.3": "Press and <b>release RESET</b>, then release BOOT.",
      "prep.note": "The screen of the controller stays off in update mode — that is normal.",
      "prep.note2": "First time on a new computer or phone, the app asks you to pick the USB device from a list — just follow the on-screen prompts.",

      "s3.title": "Update",
      "btn.cancel": "Cancel",
      "btn.updCtrl": "Update controller",
      "btn.updCtrlDesc": "System firmware + controller software (ESP32 untouched)",
      "btn.updCloud": "Update cloud module (ESP32)",
      "btn.updCloudDesc": "Only the ESP32 cloud firmware — the controller software is kept",
      "btn.updBoth": "Update controller + cloud",
      "btn.updBothDesc": "Everything: system firmware, controller software and ESP32",
      "gate.reboot.btn": "It is in BOOT mode — continue",
      "gate.reboot.text": "The controller left update mode before the connection was made (its 15-second window closed). Put it back in BOOT mode: hold BOOT, press and release RESET, release BOOT. Then press continue — the update restarts by itself.",
      "d.winLost": "The controller left update mode — one more BOOT-mode cycle is needed.",
      "err.noEsp": "No ESP32 (cloud) module was detected on this board.",
      "hint.noEsp": "This looks like the board version without the cloud module. The controller restarts with its existing software by itself (press RESET once if it does not).",
      "err.noEspFiles": "This firmware version contains no ESP32 (cloud) files.",
      "d.finishCloud": "Cloud module updated in {t} s. The controller now restarts by itself and returns to its existing software after ~15 seconds (green status LED; older firmware: sky-blue). Press RESET once if it does not.",
      "res.cloudOk.text": "The ESP32 cloud firmware is installed. The controller restarts by itself and returns to its existing software after ~15 seconds — check for the green status LED (older firmware: sky-blue); press RESET once if it does not appear.",

      "adv.title": "Advanced",
      "adv.autoJump": "Restart the controller automatically when done",
      "adv.nextBoot": "Next system firmware to be used:",
      "btn.switch": "switch",
      "adv.history": "Previous updates on this device:",
      "history.empty": "No updates recorded yet.",

      "log.title": "Technical log",
      "btn.copy": "Copy",
      "btn.clear": "Clear",
      "btn.save": "Save",

      "settings.title": "Settings",
      "settings.lang": "Language",
      "settings.url": "Firmware server (manifest URL)",
      "settings.demo": "Demo mode (simulated device, for trying the app)",
      "settings.demoEsp": "Simulated board has an ESP32",
      "btn.clearCache": "Clear downloaded firmware cache",
      "btn.done": "Done",
      "msg.cacheCleared": "Firmware cache cleared.",

      "foot.usb": "USB support:",
      "foot.noUsb": "No USB support in this browser",

      "st.download": "Download software",
      "st.system": "System firmware",
      "st.connect": "Connect",
      "st.esp": "ESP32 module",
      "st.app": "Controller software",
      "st.finish": "Finish",

      "plat.ios": "<b>iPhone / iPad cannot flash over USB.</b> Apple does not allow browsers or apps to talk to USB serial devices (MFi-only). You can browse the firmware versions here, but to update the controller please use an <b>Android phone with a USB-OTG cable</b> or a <b>computer with Chrome/Edge</b>.",
      "plat.noUsb": "<b>This browser cannot access USB.</b> Please open this page in <b>Chrome</b> or <b>Edge</b>.",
      "plat.noUsbAndroid": "<b>This browser cannot access USB.</b> Please open this page in <b>Chrome</b> (Chrome on Android supports USB-OTG).",
      "plat.android": "Android detected — updating works over a <b>USB-OTG</b> cable. When asked, allow Chrome to access the USB device.",

      "ver.prefix": "Version",
      "tag.latest": "Latest",
      "tag.esp": "+ ESP32",

      "d.loading": "Loading firmware list…",
      "d.readingLocal": "Reading local files…",
      "d.localLoaded": "Files loaded from this device.",
      "d.downloading": "Downloading version {v}…",
      "d.pkgReady": "Version {v} ready.",
      "d.pkgReadyEsp": "Version {v} ready (incl. ESP32 files).",
      "d.sysFlashing": "Flashing system firmware {b} ({s})…",
      "d.sysErasing": "Erasing internal flash…",
      "d.sysWriting": "Writing {b}…",
      "d.sysDone": "System firmware {b} installed.",
      "d.sysSkipped": "Skipped (device already in update mode).",
      "d.waitPort": "Waiting for the controller's USB serial port…",
      "d.connected": "Connected to the update firmware.",
      "d.reconWait": "Reconnecting after the ESP32 upload…",
      "d.reconnected": "Reconnected.",
      "d.extErase": "Erasing controller memory (up to 2 minutes)…",
      "d.extEraseSec": "Erasing controller memory… {t} s",
      "d.extErased": "Memory erased — ready for the new software.",
      "d.espCheck": "Checking whether this board has an ESP32 module…",
      "d.espFound": "ESP32 found — installing ESP32 package…",
      "d.espErase": "ESP32 is erasing its flash (can take up to 30 s)…",
      "d.espProg": "Installing ESP32 firmware… {p}%",
      "d.espDone": "ESP32 firmware installed.",
      "d.espNoFiles": "ESP32 found, but this package contains no ESP32 firmware — skipped.",
      "d.espNone": "No ESP32 on this board (normal for the non-ESP version) — skipped.",
      "d.appInstalling": "Installing controller software ({s})…",
      "d.appProg": "Installing controller software… {p}%",
      "d.appDone": "Controller software installed and verified.",
      "d.restarting": "Restarting the controller…",
      "d.bootHigh": "IMPORTANT: the BOOT switch is still in the update position — put it back to normal, or the controller will not start after the next power-off.",
      "d.restartWait": "Controller is restarting — waiting for the new software to start (~15 s)…",
      "d.finishRunning": "Update complete in {t} s — the controller restarted and the NEW SOFTWARE IS RUNNING. Check the status LED.",
      "d.finishAuto": "Update complete in {t} s. The controller now reboots, checks the new software for ~15 seconds and starts it. Wait for the GREEN status LED (older firmware: sky-blue); if it does not appear, press RESET once.",
      "d.finishManual": "Update complete. Press RESET on the controller to start the new software.",

      "gate.dfu.btn": "Connect to the controller (BOOT mode)",
      "gate.dfu.text": "Put the controller in update mode first: hold BOOT, press+release RESET, release BOOT. Then click and pick “STM32 BOOTLOADER” / “DFU in FS Mode”.",
      "gate.ser.btn": "Connect to the controller's serial port",
      "gate.ser.text": "Click, SELECT the controller's port in the list — it is usually named “STM32 Virtual ComPort”, “USB Serial Device” or “STM32 Bootloader” (COMxx) — then press Connect.",
      "gate.boot.btn": "Controller is in BOOT mode — connect",
      "gate.connect.text": "Board running normally (screen on): press “Controller is running — connect” and pick “STM32 Virtual ComPort” from the list. Board in BOOT mode instead (hold BOOT, press+release RESET, release BOOT): press the blue button and pick “STM32 BOOTLOADER”.",
      "gate.connect.tipPc": "Tip: start the updater with CLICK_ME_START_ON_PC.bat and approve its one-time admin popup — after that the connection is fully automatic and this question never appears.",
      "d.stallRetry": "The controller stopped accepting data — retrying more gently after a power cycle.",
      "gate.power.btn": "I switched the controller off and on",
      "gate.power.text": "Switch the controller OFF and ON (no BOOT switch needed). The update then restarts by itself, writing more slowly. If it is already back, this continues on its own.",
      "gate.connect.tipMobile": "You only have to pick the device once — this phone remembers it for the next update.",
      "gate.run.btn": "It is running normally — pick its port",
      "d.cmdReboot": "Asking the controller to enter update mode…",
      "d.sysCmd": "Not needed — the controller entered update mode by itself.",

      "res.ok.title": "Update complete ✔",
      "res.ok.text": "Wait for the controller to restart (about 15 seconds), then check for the green status LED (older firmware: sky-blue). If it does not light up, press RESET once.",
      "res.fail.title": "Update failed",
      "res.action.ok": "Done ✔",
      "res.action.text": "The selected action finished successfully.",
      "res.action.fail": "Action failed",

      "val.main": "\"{f}\" does not look like a valid controller application (M*.bin).",
      "val.boot": "\"{f}\" does not look like a valid system firmware file (B*.bin).",
      "val.esp": "\"{f}\" does not look like a valid ESP32 image.",

      "hint.boot": "Re-enter BOOT mode (hold BOOT, press RESET, release BOOT) and try again.",
      "hint.driver": "On Windows: with the board in BOOT mode, run tools\\INSTALL_DFU_DRIVER.bat once (automatic, uses Windows' own driver). On Android just accept the USB permission dialog.",
      "hint.retry": "Power the controller OFF and ON (no BOOT switch needed), then press the update button again - the update restarts automatically from the beginning.",
      "err.sigMissing": "SECURITY: the firmware list has no signature (manifest.json.sig is missing). Refusing to use it.",
      "err.channel": "SECURITY: this firmware list belongs to another customer ({theirs}), not to this installation ({mine}). Refusing to use it.",
      "hint.channel": "Use the updater package supplied for your company, or contact GATA support.",
      "err.sigBad": "SECURITY: the firmware list signature is INVALID - this content is not from GATA. Refusing to use it.",
      "hint.sig": "If you just published a release yourself, sign it: publish_firmware.ps1 signs automatically (after the one-time tools\\make_signing_key.ps1), and manifest.json.sig must be uploaded next to manifest.json.",
      "hint.pickBoth": "Pick both B1.bin and B3.bin, or use the cloud package.",
      "hint.portBusy": "Close any other program using the port, unplug/replug the USB cable, then retry.",
      "err.cancelled": "Update cancelled by the user.",

      "action.full": "Controller + cloud",
      "action.ctrl": "Controller",
      "action.cloud": "Cloud module",
      "action.app": "App only",
      "action.esp": "ESP32 only",
      "action.system": "System only",
      "hist.ok": "OK",
      "hist.fail": "failed",
    },

    /* ------------------------------------------------------------- Arabic */
    ar: {
      "app.title": "محدّث برامج GATA",
      "app.subtitle": "تحديث البرنامج من السحابة عبر USB",
      "banner.demo": "وضع التجربة — لا يوجد جهاز حقيقي. يمكن إيقافه من الإعدادات.",

      "s1.title": "اختر البرنامج",
      "badge.cloud": "سحابة",
      "badge.local": "مجلد المحدّث",
      "btn.refresh": "تحديث القائمة",
      "btn.useLocal": "استخدام الملفات الموجودة في مجلد المحدّث",
      "btn.useCloud": "العودة إلى إصدارات السحابة",
      "local.hint": "الملفات الموجودة في مجلدي main_firmware و cloud_firmware داخل مجلد المحدّث:",
      "local.rescan": "إعادة الفحص",
      "local.sys": "برنامج النظام",
      "local.main": "برنامج وحدة التحكم",
      "local.esp": "وحدة السحابة (ESP32)",
      "local.missing": "غير موجود",
      "local.espComplete": "كاملة (4 ملفات)",
      "local.espFwOnly": "firmware.bin فقط (يتطلب ESP32 مبرمجًا مسبقًا)",
      "local.noMain": "لا يوجد برنامج وحدة تحكم (M*.bin) في مجلد main_firmware.",
      "local.noBoot": "لم يتم العثور على B1.bin / B3.bin في مجلد main_firmware.",
      "local.hintFiles": "ضع الملفات داخل مجلد المحدّث هكذا: main_firmware\\B1.bin و B3.bin و M*.bin — cloud_firmware\\bootloader.bin و partitions.bin و boot_app0.bin و firmware.bin. ثم اضغط «إعادة الفحص».",
      "local.oldServer": "تعذّر عرض محتويات المجلد — خادم التشغيل المحلي الحالي إصدار قديم. أغلق نافذته السوداء، شغّل CLICK_ME_START_ON_PC.bat مرة أخرى، ثم اضغط «إعادة الفحص».",
      "opt": "(اختياري)",

      "s2.title": "تجهيز وحدة التحكم",
      "prep.1.pc": "وصّل وحدة التحكم بهذا الكمبيوتر بكابل USB.",
      "prep.1.phone": "وصّل وحدة التحكم بهذا الهاتف عبر محوّل USB-OTG.",
      "prep.2": "اضغط <b>باستمرار على زر BOOT</b>.",
      "prep.3": "اضغط ثم <b>حرّر زر RESET</b>، ثم حرّر زر BOOT.",
      "prep.note": "تبقى شاشة وحدة التحكم مطفأة في وضع التحديث — هذا طبيعي.",
      "prep.note2": "في أول مرة على كمبيوتر أو هاتف جديد، سيطلب التطبيق اختيار جهاز USB من قائمة — فقط اتبع التعليمات الظاهرة.",

      "s3.title": "التحديث",
      "btn.cancel": "إلغاء",
      "btn.updCtrl": "تحديث وحدة التحكم",
      "btn.updCtrlDesc": "برنامج النظام + برنامج وحدة التحكم (بدون لمس ESP32)",
      "btn.updCloud": "تحديث وحدة السحابة (ESP32)",
      "btn.updCloudDesc": "برنامج ESP32 السحابي فقط — يبقى برنامج وحدة التحكم كما هو",
      "btn.updBoth": "تحديث وحدة التحكم + السحابة",
      "btn.updBothDesc": "كل شيء: برنامج النظام وبرنامج وحدة التحكم و ESP32",
      "gate.reboot.btn": "الجهاز في وضع BOOT — متابعة",
      "gate.reboot.text": "خرجت وحدة التحكم من وضع التحديث قبل إتمام الاتصال (انتهت نافذة الـ15 ثانية). أعدها إلى وضع BOOT: اضغط باستمرار على BOOT، اضغط وحرّر RESET، ثم حرّر BOOT. ثم اضغط متابعة — سيُعاد التحديث تلقائيًا.",
      "d.winLost": "خرجت وحدة التحكم من وضع التحديث — نحتاج دورة BOOT إضافية.",
      "err.noEsp": "لم يتم اكتشاف وحدة ESP32 (السحابة) على هذه اللوحة.",
      "hint.noEsp": "يبدو أن هذه نسخة اللوحة بدون وحدة السحابة. ستُعيد وحدة التحكم التشغيل بنفسها وتعود إلى برنامجها الحالي (اضغط RESET مرة إن لم يحدث).",
      "err.noEspFiles": "هذا الإصدار لا يحتوي على ملفات ESP32 (السحابة).",
      "d.finishCloud": "تم تحديث وحدة السحابة خلال {t} ثانية. ستُعيد وحدة التحكم التشغيل بنفسها وتعود إلى برنامجها الحالي بعد ~15 ثانية (المؤشر الأخضر؛ الإصدارات الأقدم: أزرق سماوي). اضغط RESET مرة واحدة إن لم يحدث.",
      "res.cloudOk.text": "تم تثبيت برنامج ESP32 السحابي. ستُعيد وحدة التحكم التشغيل بنفسها وتعود إلى برنامجها الحالي بعد ~15 ثانية — تحقق من المؤشر الأخضر (الإصدارات الأقدم: أزرق سماوي)؛ اضغط RESET مرة واحدة إن لم يظهر.",

      "adv.title": "خيارات متقدمة",
      "adv.autoJump": "إعادة تشغيل وحدة التحكم تلقائيًا عند الانتهاء",
      "adv.nextBoot": "برنامج النظام التالي الذي سيُستخدم:",
      "btn.switch": "تبديل",
      "adv.history": "التحديثات السابقة على هذا الجهاز:",
      "history.empty": "لا توجد تحديثات مسجّلة بعد.",

      "log.title": "السجل الفني",
      "btn.copy": "نسخ",
      "btn.clear": "مسح",
      "btn.save": "حفظ",

      "settings.title": "الإعدادات",
      "settings.lang": "اللغة",
      "settings.url": "خادم البرامج (رابط manifest)",
      "settings.demo": "وضع التجربة (جهاز محاكى لتجربة التطبيق)",
      "settings.demoEsp": "اللوحة المحاكاة تحتوي على ESP32",
      "btn.clearCache": "مسح ذاكرة البرامج المنزّلة",
      "btn.done": "تم",
      "msg.cacheCleared": "تم مسح ذاكرة البرامج.",

      "foot.usb": "دعم USB:",
      "foot.noUsb": "لا يدعم هذا المتصفح USB",

      "st.download": "تنزيل البرنامج",
      "st.system": "برنامج النظام",
      "st.connect": "الاتصال",
      "st.esp": "وحدة ESP32",
      "st.app": "برنامج وحدة التحكم",
      "st.finish": "الإنهاء",

      "plat.ios": "<b>لا يمكن التحديث عبر USB من iPhone / iPad.</b> لا تسمح Apple للمتصفحات أو التطبيقات بالاتصال بأجهزة USB التسلسلية. يمكنك تصفّح الإصدارات هنا، ولكن لتحديث وحدة التحكم استخدم <b>هاتف Android مع كابل USB-OTG</b> أو <b>كمبيوتر مع Chrome/Edge</b>.",
      "plat.noUsb": "<b>هذا المتصفح لا يستطيع الوصول إلى USB.</b> افتح هذه الصفحة في <b>Chrome</b> أو <b>Edge</b>.",
      "plat.noUsbAndroid": "<b>هذا المتصفح لا يستطيع الوصول إلى USB.</b> افتح هذه الصفحة في <b>Chrome</b> (يدعم Chrome على Android منفذ USB-OTG).",
      "plat.android": "تم اكتشاف Android — يعمل التحديث عبر كابل <b>USB-OTG</b>. عند السؤال، اسمح لـ Chrome بالوصول إلى جهاز USB.",

      "ver.prefix": "الإصدار",
      "tag.latest": "الأحدث",
      "tag.esp": "+ ESP32",

      "d.loading": "جارٍ تحميل قائمة البرامج…",
      "d.readingLocal": "جارٍ قراءة الملفات المحلية…",
      "d.localLoaded": "تم تحميل الملفات من هذا الجهاز.",
      "d.downloading": "جارٍ تنزيل الإصدار {v}…",
      "d.pkgReady": "الإصدار {v} جاهز.",
      "d.pkgReadyEsp": "الإصدار {v} جاهز (مع ملفات ESP32).",
      "d.sysFlashing": "جارٍ تثبيت برنامج النظام {b} ({s})…",
      "d.sysErasing": "جارٍ مسح الذاكرة الداخلية…",
      "d.sysWriting": "جارٍ كتابة {b}…",
      "d.sysDone": "تم تثبيت برنامج النظام {b}.",
      "d.sysSkipped": "تم التخطي (الجهاز في وضع التحديث بالفعل).",
      "d.waitPort": "بانتظار منفذ USB التسلسلي لوحدة التحكم…",
      "d.connected": "تم الاتصال ببرنامج التحديث.",
      "d.reconWait": "جارٍ إعادة الاتصال بعد تحديث ESP32…",
      "d.reconnected": "تمت إعادة الاتصال.",
      "d.extErase": "جارٍ مسح ذاكرة وحدة التحكم (حتى دقيقتين)…",
      "d.extEraseSec": "جارٍ مسح ذاكرة وحدة التحكم… {t} ث",
      "d.extErased": "تم مسح الذاكرة — جاهزة للبرنامج الجديد.",
      "d.espCheck": "جارٍ التحقق من وجود وحدة ESP32 على هذه اللوحة…",
      "d.espFound": "تم العثور على ESP32 — جارٍ تثبيت حزمة ESP32…",
      "d.espErase": "ESP32 يمسح ذاكرته (قد يستغرق حتى 30 ثانية)…",
      "d.espProg": "جارٍ تثبيت برنامج ESP32… {p}%",
      "d.espDone": "تم تثبيت برنامج ESP32.",
      "d.espNoFiles": "تم العثور على ESP32، لكن هذه الحزمة لا تحتوي على برنامج ESP32 — تم التخطي.",
      "d.espNone": "لا يوجد ESP32 على هذه اللوحة (طبيعي للنسخة بدون ESP) — تم التخطي.",
      "d.appInstalling": "جارٍ تثبيت برنامج وحدة التحكم ({s})…",
      "d.appProg": "جارٍ تثبيت برنامج وحدة التحكم… {p}%",
      "d.appDone": "تم تثبيت برنامج وحدة التحكم والتحقق منه.",
      "d.restarting": "جارٍ إعادة تشغيل وحدة التحكم…",
      "d.bootHigh": "هام: ما يزال مفتاح BOOT في وضع التحديث — أعده إلى وضعه الطبيعي وإلا فلن تعمل وحدة التحكم بعد فصل الطاقة القادم.",
      "d.restartWait": "وحدة التحكم تُعيد التشغيل — بانتظار بدء البرنامج الجديد (~15 ثانية)…",
      "d.finishRunning": "اكتمل التحديث خلال {t} ثانية — أعادت وحدة التحكم التشغيل والبرنامج الجديد يعمل الآن. تحقق من مؤشر الحالة.",
      "d.finishAuto": "اكتمل التحديث خلال {t} ثانية. ستُعيد وحدة التحكم التشغيل الآن وتفحص البرنامج الجديد لمدة ~15 ثانية ثم تبدأه. انتظر المؤشر الضوئي الأخضر (الإصدارات الأقدم: أزرق سماوي)؛ إن لم يظهر اضغط RESET مرة واحدة.",
      "d.finishManual": "اكتمل التحديث. اضغط RESET على وحدة التحكم لبدء البرنامج الجديد.",

      "gate.dfu.btn": "الاتصال بوحدة التحكم (وضع BOOT)",
      "gate.dfu.text": "ضع وحدة التحكم في وضع التحديث أولاً: اضغط باستمرار على BOOT، اضغط وحرّر RESET، ثم حرّر BOOT. ثم انقر واختر “STM32 BOOTLOADER” / “DFU in FS Mode”.",
      "gate.ser.btn": "الاتصال بالمنفذ التسلسلي لوحدة التحكم",
      "gate.ser.text": "انقر ثم اختر منفذ وحدة التحكم من القائمة — يظهر عادةً باسم “STM32 Virtual ComPort” أو “USB Serial Device” أو “STM32 Bootloader” (COMxx) — ثم اضغط Connect.",
      "gate.boot.btn": "وحدة التحكم في وضع BOOT — اتصال",
      "gate.connect.text": "اللوحة تعمل بشكل طبيعي (الشاشة مضاءة): اضغط زر «اللوحة تعمل — اتصل» واختر “STM32 Virtual ComPort” من القائمة. أما إذا كانت اللوحة في وضع BOOT (اضغط باستمرار BOOT، اضغط وحرّر RESET، ثم حرّر BOOT): اضغط الزر الأزرق واختر “STM32 BOOTLOADER”.",
      "gate.connect.tipPc": "نصيحة: شغّل المحدّث عبر CLICK_ME_START_ON_PC.bat ووافق على نافذة المسؤول التي تظهر مرة واحدة — بعدها يصبح الاتصال تلقائيًا بالكامل ولن يظهر هذا السؤال مجددًا.",
      "d.stallRetry": "توقفت اللوحة عن استقبال البيانات — سنعيد المحاولة بسرعة أبطأ بعد إعادة التشغيل.",
      "gate.power.btn": "أطفأتُ اللوحة ثم شغّلتها",
      "gate.power.text": "أطفئ اللوحة ثم شغّلها (لا حاجة لمفتاح BOOT). سيبدأ التحديث تلقائيًا من جديد بكتابة أبطأ. وإذا عادت اللوحة بالفعل فسيكمل العمل تلقائيًا.",
      "gate.connect.tipMobile": "ستختار الجهاز مرة واحدة فقط — سيتذكره الهاتف في التحديث القادم.",
      "gate.run.btn": "تعمل بشكل طبيعي — اختر منفذها",
      "d.cmdReboot": "جارٍ الطلب من وحدة التحكم الدخول في وضع التحديث…",
      "d.sysCmd": "غير مطلوب — دخلت وحدة التحكم وضع التحديث بنفسها.",

      "res.ok.title": "اكتمل التحديث ✔",
      "res.ok.text": "انتظر إعادة تشغيل وحدة التحكم (حوالي 15 ثانية)، ثم تحقق من المؤشر الضوئي الأخضر (الإصدارات الأقدم: أزرق سماوي). إن لم يضئ اضغط RESET مرة واحدة.",
      "res.fail.title": "فشل التحديث",
      "res.action.ok": "تم ✔",
      "res.action.text": "اكتمل الإجراء المحدد بنجاح.",
      "res.action.fail": "فشل الإجراء",

      "val.main": "الملف \"{f}\" لا يبدو برنامج وحدة تحكم صالحًا (M*.bin).",
      "val.boot": "الملف \"{f}\" لا يبدو ملف برنامج نظام صالحًا (B*.bin).",
      "val.esp": "الملف \"{f}\" لا يبدو صورة ESP32 صالحة.",

      "hint.boot": "أعد الدخول إلى وضع BOOT (اضغط باستمرار BOOT، اضغط RESET، حرّر BOOT) وحاول مجددًا.",
      "hint.driver": "على Windows: مع اللوحة في وضع BOOT، شغّل tools\\INSTALL_DFU_DRIVER.bat مرة واحدة (تلقائي، يستخدم تعريف Windows نفسه). على Android اقبل نافذة إذن USB فقط.",
      "hint.retry": "أطفئ اللوحة ثم شغّلها (لا حاجة لمفتاح BOOT)، ثم اضغط زر التحديث مرة أخرى - سيبدأ التحديث تلقائياً من جديد.",
      "err.sigMissing": "أمان: قائمة البرامج بلا توقيع (ملف manifest.json.sig مفقود). تم رفض استخدامها.",
      "err.channel": "أمان: قائمة البرامج هذه تخص عميلاً آخر ({theirs})، وليست لهذا التثبيت ({mine}). تم رفض استخدامها.",
      "hint.channel": "استخدم نسخة التحديث المخصصة لشركتك، أو تواصل مع دعم GATA.",
      "err.sigBad": "أمان: توقيع قائمة البرامج غير صحيح - هذا المحتوى ليس من GATA. تم رفض استخدامه.",
      "hint.sig": "إذا كنت أنت من نشر الإصدار، وقّعه: publish_firmware.ps1 يوقّع تلقائياً (بعد تشغيل make_signing_key.ps1 مرة واحدة)، ويجب رفع manifest.json.sig بجوار manifest.json.",
      "hint.pickBoth": "اختر الملفين B1.bin و B3.bin معًا، أو استخدم حزمة السحابة.",
      "hint.portBusy": "أغلق أي برنامج آخر يستخدم المنفذ، افصل ثم أعد توصيل كابل USB، وحاول مجددًا.",
      "err.cancelled": "ألغى المستخدم التحديث.",

      "action.full": "وحدة التحكم + السحابة",
      "action.ctrl": "وحدة التحكم",
      "action.cloud": "وحدة السحابة",
      "action.app": "البرنامج فقط",
      "action.esp": "ESP32 فقط",
      "action.system": "النظام فقط",
      "hist.ok": "نجح",
      "hist.fail": "فشل",
    },

    /* ------------------------------------------------------------ Turkish */
    tr: {
      "app.title": "GATA Yazılım Güncelleyici",
      "app.subtitle": "USB üzerinden bulut yazılım güncellemesi",
      "banner.demo": "DEMO MODU — gerçek cihaz kullanılmıyor. Ayarlar'dan kapatabilirsiniz.",

      "s1.title": "Yazılımı seçin",
      "badge.cloud": "bulut",
      "badge.local": "yükleyici klasörü",
      "btn.refresh": "Listeyi yenile",
      "btn.useLocal": "Yükleyici klasöründeki dosyaları kullan",
      "btn.useCloud": "Bulut sürümlerine dön",
      "local.hint": "Yükleyici içindeki main_firmware ve cloud_firmware klasörlerinde bulunan dosyalar:",
      "local.rescan": "Yeniden tara",
      "local.sys": "Sistem yazılımı",
      "local.main": "Kontrol ünitesi yazılımı",
      "local.esp": "Bulut modülü (ESP32)",
      "local.missing": "bulunamadı",
      "local.espComplete": "tam (4 dosya)",
      "local.espFwOnly": "yalnızca firmware.bin (önceden programlanmış ESP32 gerektirir)",
      "local.noMain": "main_firmware klasöründe kontrol ünitesi yazılımı (M*.bin) yok.",
      "local.noBoot": "main_firmware klasöründe B1.bin / B3.bin bulunamadı.",
      "local.hintFiles": "Dosyaları yükleyici klasörünün içine şöyle yerleştirin: main_firmware\\B1.bin, B3.bin ve M*.bin — cloud_firmware\\bootloader.bin, partitions.bin, boot_app0.bin, firmware.bin. Sonra “Yeniden tara”ya basın.",
      "local.oldServer": "Klasör içeriği listelenemedi — çalışan yerel sunucu eski sürüm. Siyah penceresini kapatın, CLICK_ME_START_ON_PC.bat dosyasını yeniden çalıştırın, sonra “Yeniden tara”ya basın.",
      "opt": "(isteğe bağlı)",

      "s2.title": "Kontrol ünitesini hazırlayın",
      "prep.1.pc": "Kontrol ünitesini bu bilgisayara USB kablosuyla bağlayın.",
      "prep.1.phone": "Kontrol ünitesini bu telefona USB-OTG adaptörüyle bağlayın.",
      "prep.2": "<b>BOOT düğmesini basılı tutun</b>.",
      "prep.3": "<b>RESET'e basıp bırakın</b>, sonra BOOT'u bırakın.",
      "prep.note": "Güncelleme modunda kontrol ünitesinin ekranı kapalı kalır — bu normaldir.",
      "prep.note2": "Yeni bir bilgisayar veya telefonda ilk kez kullanırken uygulama USB cihazını bir listeden seçmenizi ister — ekrandaki yönergeleri izlemeniz yeterli.",

      "s3.title": "Güncelleme",
      "btn.cancel": "İptal",
      "btn.updCtrl": "Kontrol ünitesini güncelle",
      "btn.updCtrlDesc": "Sistem yazılımı + kontrol ünitesi yazılımı (ESP32'ye dokunulmaz)",
      "btn.updCloud": "Bulut modülünü güncelle (ESP32)",
      "btn.updCloudDesc": "Yalnızca ESP32 bulut yazılımı — kontrol ünitesi yazılımı korunur",
      "btn.updBoth": "Kontrol ünitesi + bulutu güncelle",
      "btn.updBothDesc": "Her şey: sistem yazılımı, kontrol ünitesi yazılımı ve ESP32",
      "gate.reboot.btn": "BOOT modunda — devam et",
      "gate.reboot.text": "Kontrol ünitesi bağlantı kurulmadan güncelleme modundan çıktı (15 saniyelik pencere kapandı). Tekrar BOOT moduna alın: BOOT'u basılı tutun, RESET'e basıp bırakın, BOOT'u bırakın. Sonra devam'a basın — güncelleme kendiliğinden yeniden başlar.",
      "d.winLost": "Kontrol ünitesi güncelleme modundan çıktı — bir BOOT döngüsü daha gerekiyor.",
      "err.noEsp": "Bu kartta ESP32 (bulut) modülü algılanmadı.",
      "hint.noEsp": "Bu, bulut modülü olmayan kart sürümüne benziyor. Kontrol ünitesi kendiliğinden yeniden başlar ve mevcut yazılımına döner (dönmezse bir kez RESET'e basın).",
      "err.noEspFiles": "Bu sürümde ESP32 (bulut) dosyaları yok.",
      "d.finishCloud": "Bulut modülü {t} sn'de güncellendi. Kontrol ünitesi kendiliğinden yeniden başlar ve ~15 saniye sonra mevcut yazılımına döner (yeşil durum LED'i; eski sürümlerde gök mavisi). Dönmezse bir kez RESET'e basın.",
      "res.cloudOk.text": "ESP32 bulut yazılımı yüklendi. Kontrol ünitesi kendiliğinden yeniden başlar ve ~15 saniye içinde mevcut yazılımına döner — yeşil durum LED'ini kontrol edin (eski sürümlerde gök mavisi); görünmezse bir kez RESET'e basın.",

      "adv.title": "Gelişmiş",
      "adv.autoJump": "Bittiğinde kontrol ünitesini otomatik yeniden başlat",
      "adv.nextBoot": "Bir sonraki kullanılacak sistem yazılımı:",
      "btn.switch": "değiştir",
      "adv.history": "Bu cihazdaki önceki güncellemeler:",
      "history.empty": "Henüz kayıtlı güncelleme yok.",

      "log.title": "Teknik günlük",
      "btn.copy": "Kopyala",
      "btn.clear": "Temizle",
      "btn.save": "Kaydet",

      "settings.title": "Ayarlar",
      "settings.lang": "Dil",
      "settings.url": "Yazılım sunucusu (manifest adresi)",
      "settings.demo": "Demo modu (uygulamayı denemek için simüle cihaz)",
      "settings.demoEsp": "Simüle kartta ESP32 var",
      "btn.clearCache": "İndirilen yazılım önbelleğini temizle",
      "btn.done": "Tamam",
      "msg.cacheCleared": "Yazılım önbelleği temizlendi.",

      "foot.usb": "USB desteği:",
      "foot.noUsb": "Bu tarayıcıda USB desteği yok",

      "st.download": "Yazılımı indir",
      "st.system": "Sistem yazılımı",
      "st.connect": "Bağlan",
      "st.esp": "ESP32 modülü",
      "st.app": "Kontrol ünitesi yazılımı",
      "st.finish": "Bitir",

      "plat.ios": "<b>iPhone / iPad USB üzerinden yazılım yükleyemez.</b> Apple, tarayıcıların veya uygulamaların USB seri cihazlarla konuşmasına izin vermez. Sürümlere buradan göz atabilirsiniz, ancak güncelleme için <b>USB-OTG kablolu bir Android telefon</b> veya <b>Chrome/Edge yüklü bir bilgisayar</b> kullanın.",
      "plat.noUsb": "<b>Bu tarayıcı USB'ye erişemiyor.</b> Lütfen bu sayfayı <b>Chrome</b> veya <b>Edge</b> ile açın.",
      "plat.noUsbAndroid": "<b>Bu tarayıcı USB'ye erişemiyor.</b> Lütfen bu sayfayı <b>Chrome</b> ile açın (Android'de Chrome USB-OTG destekler).",
      "plat.android": "Android algılandı — güncelleme <b>USB-OTG</b> kablosuyla çalışır. Sorulduğunda Chrome'un USB cihazına erişmesine izin verin.",

      "ver.prefix": "Sürüm",
      "tag.latest": "En yeni",
      "tag.esp": "+ ESP32",

      "d.loading": "Yazılım listesi yükleniyor…",
      "d.readingLocal": "Yerel dosyalar okunuyor…",
      "d.localLoaded": "Dosyalar bu cihazdan yüklendi.",
      "d.downloading": "Sürüm {v} indiriliyor…",
      "d.pkgReady": "Sürüm {v} hazır.",
      "d.pkgReadyEsp": "Sürüm {v} hazır (ESP32 dosyaları dahil).",
      "d.sysFlashing": "Sistem yazılımı {b} yükleniyor ({s})…",
      "d.sysErasing": "Dahili bellek siliniyor…",
      "d.sysWriting": "{b} yazılıyor…",
      "d.sysDone": "Sistem yazılımı {b} yüklendi.",
      "d.sysSkipped": "Atlandı (cihaz zaten güncelleme modunda).",
      "d.waitPort": "Kontrol ünitesinin USB seri portu bekleniyor…",
      "d.connected": "Güncelleme yazılımına bağlandı.",
      "d.reconWait": "ESP32 yüklemesinden sonra yeniden bağlanılıyor…",
      "d.reconnected": "Yeniden bağlandı.",
      "d.extErase": "Kontrol ünitesi belleği siliniyor (2 dakikaya kadar)…",
      "d.extEraseSec": "Kontrol ünitesi belleği siliniyor… {t} sn",
      "d.extErased": "Bellek silindi — yeni yazılım için hazır.",
      "d.espCheck": "Bu kartta ESP32 modülü var mı kontrol ediliyor…",
      "d.espFound": "ESP32 bulundu — ESP32 paketi yükleniyor…",
      "d.espErase": "ESP32 belleğini siliyor (30 sn sürebilir)…",
      "d.espProg": "ESP32 yazılımı yükleniyor… %{p}",
      "d.espDone": "ESP32 yazılımı yüklendi.",
      "d.espNoFiles": "ESP32 bulundu ama bu pakette ESP32 yazılımı yok — atlandı.",
      "d.espNone": "Bu kartta ESP32 yok (ESP'siz sürüm için normal) — atlandı.",
      "d.appInstalling": "Kontrol ünitesi yazılımı yükleniyor ({s})…",
      "d.appProg": "Kontrol ünitesi yazılımı yükleniyor… %{p}",
      "d.appDone": "Kontrol ünitesi yazılımı yüklendi ve doğrulandı.",
      "d.restarting": "Kontrol ünitesi yeniden başlatılıyor…",
      "d.bootHigh": "ÖNEMLİ: BOOT anahtarı hâlâ güncelleme konumunda — normale geri alın, yoksa bir sonraki güç kesintisinden sonra kontrol ünitesi başlamaz.",
      "d.restartWait": "Kontrol ünitesi yeniden başlıyor — yeni yazılımın başlaması bekleniyor (~15 sn)…",
      "d.finishRunning": "Güncelleme {t} sn'de tamamlandı — kontrol ünitesi yeniden başladı ve YENİ YAZILIM ÇALIŞIYOR. Durum LED'ini kontrol edin.",
      "d.finishAuto": "Güncelleme {t} sn'de tamamlandı. Kontrol ünitesi şimdi yeniden başlar, yeni yazılımı ~15 saniye denetler ve çalıştırır. YEŞİL durum LED'ini bekleyin (eski sürümlerde gök mavisi); görünmezse bir kez RESET'e basın.",
      "d.finishManual": "Güncelleme tamamlandı. Yeni yazılımı başlatmak için kontrol ünitesinde RESET'e basın.",

      "gate.dfu.btn": "Kontrol ünitesine bağlan (BOOT modu)",
      "gate.dfu.text": "Önce kontrol ünitesini güncelleme moduna alın: BOOT'u basılı tutun, RESET'e basıp bırakın, BOOT'u bırakın. Sonra tıklayın ve “STM32 BOOTLOADER” / “DFU in FS Mode” cihazını seçin.",
      "gate.ser.btn": "Kontrol ünitesinin seri portuna bağlan",
      "gate.ser.text": "Tıklayın, listeden kontrol ünitesinin portunu SEÇİN — genellikle “STM32 Virtual ComPort”, “USB Serial Device” veya “STM32 Bootloader” (COMxx) olarak görünür — sonra Connect'e basın.",
      "gate.boot.btn": "Kontrol ünitesi BOOT modunda — bağlan",
      "gate.connect.text": "Kart normal çalışıyorsa (ekran açık): “Kontrolör çalışıyor — bağlan” düğmesine basın ve listeden “STM32 Virtual ComPort”u seçin. Kart BOOT modundaysa (BOOT'u basılı tutun, RESET'e basıp bırakın, BOOT'u bırakın): mavi düğmeye basın ve “STM32 BOOTLOADER”ı seçin.",
      "gate.connect.tipPc": "İpucu: güncelleyiciyi CLICK_ME_START_ON_PC.bat ile başlatın ve bir kez görünen yönetici penceresini onaylayın — sonrasında bağlantı tamamen otomatik olur ve bu soru bir daha görünmez.",
      "d.stallRetry": "Kontrol ünitesi veri almayı durdurdu — kapatıp açtıktan sonra daha yavaş yeniden denenecek.",
      "gate.power.btn": "Kontrol ünitesini kapatıp açtım",
      "gate.power.text": "Kontrol ünitesini KAPATIP AÇIN (BOOT anahtarı gerekmez). Güncelleme daha yavaş yazarak kendiliğinden yeniden başlar. Kart zaten geri geldiyse işlem kendiliğinden devam eder.",
      "gate.connect.tipMobile": "Cihazı yalnızca bir kez seçmeniz yeterli — telefon bir sonraki güncellemede hatırlar.",
      "gate.run.btn": "Normal çalışıyor — portunu seç",
      "d.cmdReboot": "Kontrol ünitesinden güncelleme moduna girmesi isteniyor…",
      "d.sysCmd": "Gerekmedi — kontrol ünitesi güncelleme moduna kendisi girdi.",

      "res.ok.title": "Güncelleme tamamlandı ✔",
      "res.ok.text": "Kontrol ünitesinin yeniden başlamasını bekleyin (yaklaşık 15 saniye), sonra yeşil durum LED'ini kontrol edin (eski sürümlerde gök mavisi). Yanmazsa bir kez RESET'e basın.",
      "res.fail.title": "Güncelleme başarısız",
      "res.action.ok": "Tamam ✔",
      "res.action.text": "Seçilen işlem başarıyla tamamlandı.",
      "res.action.fail": "İşlem başarısız",

      "val.main": "\"{f}\" geçerli bir kontrol ünitesi yazılımına benzemiyor (M*.bin).",
      "val.boot": "\"{f}\" geçerli bir sistem yazılımı dosyasına benzemiyor (B*.bin).",
      "val.esp": "\"{f}\" geçerli bir ESP32 imajına benzemiyor.",

      "hint.boot": "BOOT moduna yeniden girin (BOOT'u basılı tutun, RESET'e basın, BOOT'u bırakın) ve tekrar deneyin.",
      "hint.driver": "Windows'ta: kart BOOT modundayken tools\\INSTALL_DFU_DRIVER.bat dosyasını bir kez çalıştırın (otomatik, Windows'un kendi sürücüsünü kullanır). Android'de yalnızca USB izin penceresini onaylayın.",
      "hint.retry": "Kartı KAPATIP AÇIN (BOOT anahtarı gerekmez), sonra güncelleme düğmesine yeniden basın - güncelleme baştan otomatik olarak başlar.",
      "err.sigMissing": "GÜVENLİK: yazılım listesinin imzası yok (manifest.json.sig eksik). Kullanılması reddedildi.",
      "err.channel": "GÜVENLİK: bu yazılım listesi başka bir müşteriye ({theirs}) ait, bu kuruluma ({mine}) değil. Kullanılması reddedildi.",
      "hint.channel": "Şirketiniz için verilen güncelleyici paketini kullanın veya GATA desteğine başvurun.",
      "err.sigBad": "GÜVENLİK: yazılım listesi imzası GEÇERSİZ - bu içerik GATA'dan değil. Kullanılması reddedildi.",
      "hint.sig": "Yayını siz yaptıysanız imzalayın: publish_firmware.ps1 otomatik imzalar (bir kez make_signing_key.ps1 çalıştırıldıktan sonra) ve manifest.json.sig dosyası manifest.json'un yanına yüklenmelidir.",
      "hint.pickBoth": "B1.bin ve B3.bin dosyalarının ikisini de seçin veya bulut paketini kullanın.",
      "hint.portBusy": "Portu kullanan diğer programları kapatın, USB kablosunu çıkarıp takın ve tekrar deneyin.",
      "err.cancelled": "Güncelleme kullanıcı tarafından iptal edildi.",

      "action.full": "Kontrol ünitesi + bulut",
      "action.ctrl": "Kontrol ünitesi",
      "action.cloud": "Bulut modülü",
      "action.app": "Yalnızca yazılım",
      "action.esp": "Yalnızca ESP32",
      "action.system": "Yalnızca sistem",
      "hist.ok": "Başarılı",
      "hist.fail": "başarısız",
    },
  },

  init() {
    const saved = localStorage.getItem("gata.lang");
    if (saved && this.strings[saved]) this.lang = saved;
    else {
      const nav = (navigator.language || "en").slice(0, 2).toLowerCase();
      this.lang = this.strings[nav] ? nav : "en";
    }
    this.applyDirection();
  },

  setLang(lang) {
    if (!this.strings[lang]) return;
    this.lang = lang;
    localStorage.setItem("gata.lang", lang);
    this.applyDirection();
    this.applyStatic();
  },

  applyDirection() {
    document.documentElement.lang = this.lang;
    document.documentElement.dir = this.lang === "ar" ? "rtl" : "ltr";
  },

  t(key, params) {
    let s = this.strings[this.lang][key];
    if (s == null) s = this.strings.en[key];
    if (s == null) return key;
    if (params) {
      for (const k of Object.keys(params)) s = s.split("{" + k + "}").join(String(params[k]));
    }
    return s;
  },

  /* Fill every element carrying data-i18n / data-i18n-html. */
  applyStatic() {
    document.querySelectorAll("[data-i18n]").forEach(el => {
      el.textContent = this.t(el.getAttribute("data-i18n"));
    });
    document.querySelectorAll("[data-i18n-html]").forEach(el => {
      el.innerHTML = this.t(el.getAttribute("data-i18n-html"));   // our own trusted strings only
    });
    document.querySelectorAll("[data-i18n-title]").forEach(el => {
      const v = this.t(el.getAttribute("data-i18n-title"));
      el.title = v;
      el.setAttribute("aria-label", v);
    });
  },

  /* Used by the self-tests: every EN key must exist in AR and TR. */
  missingKeys() {
    const out = [];
    for (const lang of ["ar", "tr"]) {
      for (const k of Object.keys(this.strings.en)) {
        if (this.strings[lang][k] == null) out.push(lang + ":" + k);
      }
    }
    return out;
  },
};
