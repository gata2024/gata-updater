/* GATA Release Manager - the button-click front end for releasing firmware.
 *
 * Everything this window does, it does by running the SAME PowerShell scripts
 * that are documented in HOW_TO_RELEASE.html (publish_firmware.ps1,
 * new_customer.ps1, make_license.ps1). Nothing is reimplemented here, so the
 * scripts stay the single source of truth and the command that ran is always
 * printed in the log - you can copy it and run it by hand any time.
 *
 * Built with the C# compiler inside Windows (tools\build_release_manager.ps1).
 */
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

class ReleaseManager : Form
{
    /* The form occupies a fixed column of this width; the technical log fills
     * whatever is to the right of it. Sections must size themselves from THIS,
     * not from the window - reading ClientSize.Width made the cloud list and
     * its buttons stretch straight across the log. */
    const int FORM_W = 900;

    // ---- paths ------------------------------------------------------------
    static string AppDir;        // ...\GATA_Cloud_Uploader
    static string ToolsDir;      // ...\tools
    static string FirmwareDir;   // ...\firmware
    static string RepoRoot;      // ...\gc22SramToflash

    // ---- controls ---------------------------------------------------------
    ComboBox cboCustomer;
    CheckBox chkRev5, chkRev6, chkSystem, chkEsp, chkInApp;
    TextBox txtCtrl, txtSys, txtEsp, txtNotes, txtLog, txtDest;
    Button btnPublish, btnBuildFolder, btnNewCompany, btnBackup, btnOpenGuide, btnRefresh, btnCheck, btnRemove, btnRefreshCloud, btnApk;
    ListView lstCloud, lstFiles;
    Label lblFiles;
    /* The raw JSON of each listed version, kept so the file table can be filled
     * from the selection without re-reading and re-parsing the manifest. */
    readonly Dictionary<string, string> cloudBlocks = new Dictionary<string, string>();
    string lastBuiltFolder;
    Label lblStatus, lblCtrlFp, lblSysFp, lblEspFp, lblLog;
    ProgressBar bar;
    readonly ToolTip toolTip = new ToolTip();

    [System.Runtime.InteropServices.DllImport("kernel32.dll")]
    static extern bool AttachConsole(int processId);   // -1 = the parent's console

    [STAThread]
    static void Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        // The exe lives in the app folder; tools\ sits next to it.
        AppDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
        if (File.Exists(Path.Combine(AppDir, "publish_firmware.ps1")))   // started from tools\
            AppDir = Path.GetDirectoryName(AppDir);
        ToolsDir = Path.Combine(AppDir, "tools");
        FirmwareDir = Path.Combine(AppDir, "firmware");
        RepoRoot = Path.GetDirectoryName(AppDir);

        if (!File.Exists(Path.Combine(ToolsDir, "publish_firmware.ps1")))
        {
            MessageBox.Show("This program must sit in the GATA_Cloud_Uploader folder\n" +
                            "(tools\\publish_firmware.ps1 was not found).\n\nLooked in: " + ToolsDir,
                            "GATA Release Manager", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        /* Check a prepared folder as text - the same receipt arithmetic the
         * button does, for scripting and for testing:
         *     GATA_Release_Manager.exe /checkfolder <folder>
         * Exit code = number of faults (0 = safe to send).                    */
        if (args.Length >= 2 && args[0].Equals("/checkfolder", StringComparison.OrdinalIgnoreCase))
        {
            AttachConsole(-1);
            var faults = new List<string>();
            int okCount = CheckReceipt(args[1], s => Console.WriteLine(s), faults);
            foreach (string f in faults) Console.WriteLine("   !! " + f);
            Console.WriteLine("   " + okCount + " file(s) verified, " + faults.Count + " fault(s).");
            Console.WriteLine(faults.Count == 0 ? "OK - every file is exactly as delivered."
                                                : "DO NOT SEND THIS FOLDER.");
            Environment.Exit(faults.Count);
        }

        /* What is in the cloud for a company, as text - the same parsing the
         * window uses, so it can be checked without clicking:
         *     GATA_Release_Manager.exe /cloudlist <channel>                   */
        if (args.Length >= 2 && args[0].Equals("/cloudlist", StringComparison.OrdinalIgnoreCase))
        {
            AttachConsole(-1);
            string man = args[1] == "default"
                ? Path.Combine(FirmwareDir, "manifest.json")
                : Path.Combine(FirmwareDir, "customers", args[1], "manifest.json");
            if (!File.Exists(man)) { Console.WriteLine("No manifest for channel '" + args[1] + "'"); Environment.Exit(1); }
            string js = File.ReadAllText(man);
            foreach (string block in VersionBlocks(js))
            {
                string ver = ValueOf(block, "version");
                if (ver == null) continue;
                long total = 0;
                var files = FilesOf(block);
                foreach (var f in files) total += f.Size;
                Console.WriteLine("== " + ver + "   board " + (ValueOf(block, "board") ?? "rev5") +
                                  "   published " + (ValueOf(block, "date") ?? "?") +
                                  "   " + FmtSize(total) +
                                  (block.Replace(" ", "").Contains("\"latest\":true") ? "   [LATEST]" : ""));
                Console.WriteLine("   notes: " + (ValueOf(block, "notes") ?? ""));
                Console.WriteLine(string.Format("   {0,-11}{1,-40}{2,-26}{3,-11}{4,-18}{5}",
                                                "What", "Published as", "Built from", "Size", "Compiled", "Fingerprint"));
                foreach (var f in files)
                    Console.WriteLine(string.Format("   {0,-11}{1,-40}{2,-26}{3,-11}{4,-18}{5}",
                        f.What, f.Name,
                        string.IsNullOrEmpty(f.Source) ? "-" : f.Source,
                        FmtSize(f.Size),
                        string.IsNullOrEmpty(f.Built) ? "-" : f.Built,
                        string.IsNullOrEmpty(f.Sha) ? "-" : f.Sha.Substring(0, Math.Min(12, f.Sha.Length))));
            }
            Environment.Exit(0);
        }

        /* Headless folder build - same code as the button, for scripting and
         * for checking a folder without clicking:
         *     GATA_Release_Manager.exe /buildfolder <channel> <parent folder>  */
        if (args.Length >= 3 && args[0].Equals("/buildfolder", StringComparison.OrdinalIgnoreCase))
        {
            /* A winexe has no console of its own: without this, everything
             * below is written into the void when run from a shell. */
            AttachConsole(-1);
            string board = args.Length >= 4 ? args[3] : "rev5";
            bool noEsp = args.Any(a => a.Equals("/noesp", StringComparison.OrdinalIgnoreCase));
            Headless = true;
            var f = new ReleaseManager();
            string who = args[1] == "default" ? "General" : Pretty(args[1]);
            var probs = f.BuildFolderCore(args[1],
                Path.Combine(args[2], "Uploader_" + who.Replace(" ", "_") + "_" + board),
                board,
                Path.Combine(RepoRoot, @"g_500\Debug\NPC20_mini.bin"),
                Path.Combine(RepoRoot, @"USBupdaterCode_relbuild\Debug\Booster_phase.bin"),
                noEsp ? null : Path.Combine(RepoRoot, @"esp\.pio\build\esp32dev"),
                s => Console.WriteLine(s));
            foreach (string p in probs) Console.WriteLine("PROBLEM: " + p);
            Environment.Exit(probs.Count);      // 0 = the folder is good to send
            return;
        }

        Application.Run(new ReleaseManager());
    }

    /* /buildfolder needs the file-copying half of this class, not the window.
     * Building the window from a command line hung the whole run before it
     * copied a single file (and this is a /target:winexe, so nothing was
     * printed to say so). The folder build touches no control, so headless
     * mode simply skips the UI. */
    public static bool Headless;

    public ReleaseManager()
    {
        if (Headless) return;

        Text = "GATA Release Manager";
        /* Both are recomputed from the content once it is laid out: the form
         * column is a fixed 900, and the log takes whatever is beside it. */
        ClientSize = new Size(940, 700);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(246, 248, 252);
        Font = new Font("Segoe UI", 9F);

        int y = 12;

        // ---------------- 1. company ----------------
        y = Section("1.  Which company is this release for?", y);
        cboCustomer = new ComboBox { Left = 24, Top = y, Width = 300, DropDownStyle = ComboBoxStyle.DropDownList };
        Controls.Add(cboCustomer);
        btnRefresh = Mk("Refresh list", 336, y - 1, 100, (s, e) => LoadCustomers());
        btnNewCompany = Mk("Add new company...", 446, y - 1, 150, (s, e) => NewCompany());
        y += 38;

        // ---------------- 2. boards ----------------
        y = Section("2.  Which boards?", y);
        chkRev5 = new CheckBox { Left = 24, Top = y, Width = 150, Text = "Board rev 5", Checked = true };
        chkRev6 = new CheckBox { Left = 180, Top = y, Width = 150, Text = "Board rev 6", Checked = true };
        Controls.Add(chkRev5); Controls.Add(chkRev6);
        y += 34;

        // ---------------- 3. files ----------------
        y = Section("3.  Which files? (filled in for you - change only if needed)", y);

        Controls.Add(new Label { Left = 24, Top = y + 3, Width = 150, Text = "Controller software" });
        txtCtrl = new TextBox { Left = 178, Top = y, Width = 620 };
        Controls.Add(txtCtrl);
        Mk("...", 804, y - 1, 40, (s, e) => Browse(txtCtrl, "Controller software|*.bin"));
        y += 24;
        lblCtrlFp = FpLabel(y); y += 22;

        chkSystem = new CheckBox { Left = 24, Top = y + 2, Width = 154, Text = "System firmware", Checked = true };
        toolTip.SetToolTip(chkSystem,
            "Ticked: publish this system firmware as part of the release.\n" +
            "Unticked: the release keeps the system firmware already on the server\n" +
            "(use it when only the controller software changed).\n\n" +
            "A customer folder ALWAYS includes the system firmware - the updater needs it.");
        Controls.Add(chkSystem);
        txtSys = new TextBox { Left = 178, Top = y, Width = 620 };
        Controls.Add(txtSys);
        Mk("...", 804, y - 1, 40, (s, e) => Browse(txtSys, "System firmware|*.bin"));
        chkSystem.CheckedChanged += (s, e) => txtSys.Enabled = chkSystem.Checked;
        y += 24;
        lblSysFp = FpLabel(y); y += 22;

        chkEsp = new CheckBox { Left = 24, Top = y + 2, Width = 154, Text = "Cloud module (ESP32)", Checked = true };
        toolTip.SetToolTip(chkEsp, "Untick for boards without a cloud module: the release and the customer\n" +
                                   "folder then carry no ESP32 firmware at all, and the updater skips that step.");
        Controls.Add(chkEsp);
        txtEsp = new TextBox { Left = 178, Top = y, Width = 620 };
        Controls.Add(txtEsp);
        Mk("...", 804, y - 1, 40, (s, e) => BrowseFolder(txtEsp));
        chkEsp.CheckedChanged += (s, e) => txtEsp.Enabled = chkEsp.Checked;
        y += 24;
        lblEspFp = FpLabel(y); y += 26;

        /* Firmware inside the app is a PROPERTY of the release, not a separate
         * errand - so it is a tick here with the other files, and PUBLISH acts
         * on it. Unticked means the app carries nothing and every customer
         * downloads from the cloud each time they need it. */
        chkInApp = new CheckBox
        {
            Left = 24, Top = y + 2, Width = 470, Checked = true,
            Text = "Put this firmware inside the app (so a phone can install with no internet)"
        };
        toolTip.SetToolTip(chkInApp,
            "Ticked: the same files go inside this company's app and it is published,\n" +
            "so their phone stores them and can update a controller with no internet.\n\n" +
            "Unticked: the app carries NO firmware - it downloads from the cloud every\n" +
            "time, and cannot install anything without a connection.\n\n" +
            "Either way the release itself goes to the cloud.");
        Controls.Add(chkInApp);
        y += 30;

        Controls.Add(new Label { Left = 24, Top = y + 3, Width = 150, Text = "What changed (notes)" });
        txtNotes = new TextBox { Left = 178, Top = y, Width = 666 };
        Controls.Add(txtNotes);
        y += 30;

        /* Where customer folders are created. A plain box you can paste into -
         * digging through a folder tree for a path you already know is slow.
         * The last one used comes back next time. */
        Controls.Add(new Label { Left = 24, Top = y + 3, Width = 150, Text = "Put customer folders in" });
        txtDest = new TextBox { Left = 178, Top = y, Width = 620, Text = LoadDestPath() };
        Controls.Add(txtDest);
        Mk("...", 804, y - 1, 40, (s, e) => BrowseFolder(txtDest));
        y += 34;

        // ---------------- 4. actions ----------------
        y = Section("4.  Go", y);
        btnPublish = Mk("PUBLISH TO CLOUD", 24, y, 210, (s, e) => Publish());
        btnPublish.BackColor = Color.FromArgb(38, 110, 210);
        btnPublish.ForeColor = Color.White;
        btnPublish.Font = new Font("Segoe UI", 9.5F, FontStyle.Bold);
        btnPublish.Height = 34;

        btnBuildFolder = Mk("BUILD CUSTOMER UPLOADER FOLDER", 244, y, 270, (s, e) => BuildFolder());
        btnBuildFolder.Height = 34;

        btnCheck = Mk("CHECK A FOLDER", 524, y, 150, (s, e) => CheckFolder());
        btnCheck.Height = 34;
        btnCheck.Font = new Font("Segoe UI", 9F, FontStyle.Bold);
        btnApk = Mk("ANDROID APP (.apk)", 684, y, 160, (s, e) => BuildApk());
        btnApk.Height = 34;
        y += 40;
        /* No FIRMWARE INSIDE THE APP button any more - it is the tick in
         * section 3, applied by PUBLISH, so there is one action instead of a
         * button somebody had to remember to press afterwards. */
        btnBackup = Mk("Back up keys", 24, y, 120, (s, e) => BackupKeys());
        btnOpenGuide = Mk("Guide", 154, y, 80, (s, e) => OpenGuide());
        y += 36;

        // ---------------- 5. what is in the cloud right now ----------------
        y = Section("5.  In the cloud for this company right now", y);
        lstCloud = new ListView
        {
            Left = 24, Top = y, Width = 700, Height = 120, View = View.Details,
            FullRowSelect = true, MultiSelect = false, HideSelection = false,
            Anchor = AnchorStyles.Top | AnchorStyles.Left
        };
        lstCloud.Height = 96;
        lstCloud.Columns.Add("Version", 260);
        lstCloud.Columns.Add("Board", 60);
        lstCloud.Columns.Add("Date", 90);
        lstCloud.Columns.Add("", 40);           // "now" marker for the latest
        lstCloud.Columns.Add("Size", 80);
        lstCloud.Columns.Add("Notes", 240);
        Controls.Add(lstCloud);

        /* Anchored to the RIGHT edge: with Top|Left they stayed put while the
         * list stretched on a wide window and swallowed them. */
        btnRemove = Mk(FORM_W - 164, y, 140, "Remove selected", (s, e) => RemoveSelected());
        btnRemove.Height = 30;
        btnRemove.ForeColor = Color.FromArgb(170, 30, 30);
        btnRemove.Anchor = AnchorStyles.Top | AnchorStyles.Left;
        btnRefreshCloud = Mk(FORM_W - 164, y + 36, 140, "Refresh", (s, e) => LoadCloudList());
        btnRefreshCloud.Anchor = AnchorStyles.Top | AnchorStyles.Left;
        lstCloud.Width = FORM_W - 24 - 164 - 10;
        y += 104;

        /* Every file in the selected release, spelled out: the published name,
         * the file it was built from, its size, when it was compiled and its
         * fingerprint. The published names are generated, so without the
         * original name there is no way to tell which .bin a release really is. */
        lblFiles = new Label
        {
            Left = 24, Top = y, Width = 600, Height = 16,
            ForeColor = Color.FromArgb(70, 90, 120), Text = "Files in the selected version:"
        };
        Controls.Add(lblFiles);
        y += 18;
        lstFiles = new ListView
        {
            Left = 24, Top = y, Width = FORM_W - 24 - 164 - 10, Height = 132,
            View = View.Details, FullRowSelect = true, MultiSelect = false, HideSelection = false,
            Anchor = AnchorStyles.Top | AnchorStyles.Left
        };
        lstFiles.Columns.Add("What", 90);
        lstFiles.Columns.Add("Published as", 250);
        lstFiles.Columns.Add("Built from", 190);
        lstFiles.Columns.Add("Size", 80);
        lstFiles.Columns.Add("Compiled", 115);
        lstFiles.Columns.Add("Fingerprint", 110);
        Controls.Add(lstFiles);
        lstCloud.SelectedIndexChanged += (s, e) => ShowVersionFiles();
        y += 140;

        bar = new ProgressBar { Left = 24, Top = y, Width = 820, Height = 6, Style = ProgressBarStyle.Marquee, Visible = false };
        Controls.Add(bar);
        y += 12;

        lblStatus = new Label { Left = 24, Top = y, Width = 820, Height = 18, ForeColor = Color.FromArgb(70, 90, 120) };
        Controls.Add(lblStatus);
        y += 22;

        const int LOG_H = 230, MARGIN = 14;

        /* The technical log sits in the empty space to the RIGHT of the form.
         * Underneath it needed a taller window than most screens have, and it
         * was the first thing to be pushed off the bottom; beside the form it
         * uses the width that was doing nothing and grows with the window. */
        lblLog = new Label
        {
            Left = FORM_W + 16, Top = 44, Width = 300, Height = 18,
            Text = "Technical log", ForeColor = Color.FromArgb(30, 70, 140),
            Font = new Font("Segoe UI", 9.5F, FontStyle.Bold),
            Anchor = AnchorStyles.Top | AnchorStyles.Left
        };
        Controls.Add(lblLog);

        txtLog = new TextBox
        {
            Left = FORM_W + 16, Top = 66,
            Width = Math.Max(320, ClientSize.Width - FORM_W - 32),
            Height = Math.Max(LOG_H, y - 66),
            Multiline = true, ScrollBars = ScrollBars.Both, WordWrap = false, ReadOnly = true,
            BackColor = Color.FromArgb(24, 30, 44), ForeColor = Color.FromArgb(210, 222, 240),
            Font = new Font("Consolas", 8.75F),
            Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Bottom
        };
        Controls.Add(txtLog);

        /* Size the window from what is actually in it: as tall as the form
         * needs, and wide enough for the form PLUS a usable log beside it. */
        ClientSize = new Size(FORM_W + 16 + 420 + 16, y + MARGIN);
        MinimumSize = new Size(FORM_W + 60, 620);
        /* The log spans the full height of the finished window - its own
         * height had been guessed from the layout position before the window
         * was sized, which left it ending part-way down. */
        txtLog.Width = ClientSize.Width - txtLog.Left - MARGIN;
        txtLog.Height = ClientSize.Height - txtLog.Top - MARGIN;
        /* Never open taller than the screen it is on. */
        var wa = Screen.FromControl(this).WorkingArea;
        if (Height > wa.Height) Height = wa.Height;
        if (Width > wa.Width) Width = wa.Width;

        LoadCustomers();
        FillDefaultPaths();
        RefreshFingerprints();
        LoadCloudList();
        cboCustomer.SelectedIndexChanged += (s, e) => LoadCloudList();

        // keep the fingerprints honest whenever a path or tick changes
        txtCtrl.TextChanged += (s, e) => lblCtrlFp.Text = FileFp(txtCtrl.Text);
        txtSys.TextChanged += (s, e) => lblSysFp.Text = FileFp(txtSys.Text);
        txtEsp.TextChanged += (s, e) => lblEspFp.Text = EspFp(txtEsp.Text);
        chkSystem.CheckedChanged += (s, e) => RefreshFingerprints();
        chkEsp.CheckedChanged += (s, e) => RefreshFingerprints();
        Activated += (s, e) => RefreshFingerprints();   // a rebuild while the window was open
        Log("GATA Release Manager ready.");
        Log("App folder: " + AppDir);
        Log("Every action runs the documented PowerShell script - the exact command is printed here.");
    }

    // ---------------------------------------------------------------- helpers
    int Section(string title, int y)
    {
        var l = new Label
        {
            Left = 18, Top = y, Width = 880, Height = 22, Text = title,
            Font = new Font("Segoe UI", 10F, FontStyle.Bold), ForeColor = Color.FromArgb(28, 60, 110)
        };
        Controls.Add(l);
        return y + 26;
    }

    /* The line under each file box: WHEN this .bin was last built/modified,
     * so it is obvious at a glance whether it is the build you meant. (The
     * checksum that actually blocks a wrong file is kept out of sight, in the
     * folder's firmware_receipt.json.) */
    Label FpLabel(int y)
    {
        var l = new Label
        {
            Left = 178, Top = y, Width = 666, Height = 20,
            Font = new Font("Consolas", 8.25F), ForeColor = Color.FromArgb(90, 110, 140)
        };
        Controls.Add(l);
        return l;
    }

    /* What this company can actually download right now, read from their
     * signed channel manifest. */
    void LoadCloudList()
    {
        if (lstCloud == null) return;
        lstCloud.Items.Clear();
        cloudBlocks.Clear();
        if (lstFiles != null) lstFiles.Items.Clear();
        string channel = SelectedChannel();
        string manPath = channel == "default"
            ? Path.Combine(FirmwareDir, "manifest.json")
            : Path.Combine(FirmwareDir, "customers", channel, "manifest.json");
        if (!File.Exists(manPath))
        {
            lstCloud.Items.Add(new ListViewItem(new[] { "(no firmware published yet)", "", "", "", "" }));
            return;
        }
        try
        {
            string json = File.ReadAllText(manPath);
            foreach (string block in VersionBlocks(json))
            {
                string ver = ValueOf(block, "version");
                if (ver == null) continue;
                string board = ValueOf(block, "board"); if (string.IsNullOrEmpty(board)) board = "rev5";
                string date = ValueOf(block, "date") ?? "";
                string notes = ValueOf(block, "notes") ?? "";
                bool latest = block.Replace(" ", "").Contains("\"latest\":true");
                cloudBlocks[ver] = block;
                long total = 0;
                foreach (var f in FilesOf(block)) total += f.Size;
                var it = new ListViewItem(new[] { ver, board, date, latest ? "NOW" : "",
                                                  FmtSize(total), notes });
                if (latest) it.Font = new Font(lstCloud.Font, FontStyle.Bold);
                lstCloud.Items.Add(it);
            }
            if (lstCloud.Items.Count > 0) lstCloud.Items[0].Selected = true;
            ShowVersionFiles();
        }
        catch (Exception ex) { Log("Could not read the channel list: " + ex.Message); }
    }

    /* One published file, as the manifest describes it. */
    class CloudFile
    {
        public string What, Url, Source, Built, Sha;
        public long Size;
        public string Name { get { return Url == null ? "" : Url.Substring(Url.LastIndexOf('/') + 1); } }
    }

    /* When "built" is missing (a release published before that field existed)
     * the published copy still knows: a file copy keeps its modification time,
     * so the .bin sitting in firmware\ carries the moment it was compiled.
     * That is the same fact, read from the file instead of the manifest - not
     * a guess. The original NAME cannot be recovered that way, so it stays a
     * dash until the next publish records it. */
    static string BuiltFromDisk(string url)
    {
        try
        {
            string rel = url.Replace("../", "").Replace('/', '\\');
            string p = Path.Combine(FirmwareDir, rel);
            if (File.Exists(p)) return File.GetLastWriteTime(p).ToString("yyyy-MM-dd HH:mm");
        }
        catch { }
        return null;
    }

    /* The file entries of one version block, in the order they are installed.
     * "source"/"built" only exist on releases published after they were added,
     * so anything older falls back to the file on disk or shows a dash rather
     * than a wrong answer. */
    static List<CloudFile> FilesOf(string block)
    {
        var list = new List<CloudFile>();
        Action<string, string> one = (key, label) =>
        {
            string sub = ObjectOf(block, key);
            if (sub == null) return;
            string url = ValueOf(sub, "url");
            if (url == null) return;
            long size = 0;
            long.TryParse(NumberOf(sub, "size") ?? "0", out size);
            list.Add(new CloudFile
            {
                What = label, Url = url, Size = size,
                Sha = ValueOf(sub, "sha256"),
                Source = ValueOf(sub, "source"),
                Built = ValueOf(sub, "built") ?? BuiltFromDisk(url),
            });
        };
        one("controller", "Controller");
        one("system", "System");
        string esp = ObjectOf(block, "esp");
        if (esp != null)
        {
            foreach (string part in new[] { "bootloader", "partitions", "boot_app0", "firmware" })
            {
                string sub = ObjectOf(esp, part);
                if (sub == null) continue;
                long size = 0;
                long.TryParse(NumberOf(sub, "size") ?? "0", out size);
                list.Add(new CloudFile
                {
                    What = "ESP32", Url = ValueOf(sub, "url"), Size = size,
                    Sha = ValueOf(sub, "sha256"),
                    Source = ValueOf(sub, "source"),
                    Built = ValueOf(sub, "built") ?? BuiltFromDisk(ValueOf(sub, "url")),
                });
            }
        }
        one("license", "Licence");
        return list;
    }

    /* The {...} that follows "key": - depth-counted, so a nested object (esp)
     * is returned whole instead of stopping at the first closing brace. */
    static string ObjectOf(string block, string key)
    {
        int k = block.IndexOf("\"" + key + "\"");
        if (k < 0) return null;
        int open = block.IndexOf('{', k);
        if (open < 0) return null;
        int depth = 0;
        for (int i = open; i < block.Length; i++)
        {
            if (block[i] == '{') depth++;
            else if (block[i] == '}') { depth--; if (depth == 0) return block.Substring(open, i - open + 1); }
        }
        return null;
    }

    /* ValueOf reads STRINGS; sizes are bare numbers. */
    static string NumberOf(string block, string key)
    {
        int k = block.IndexOf("\"" + key + "\"");
        if (k < 0) return null;
        int c = block.IndexOf(':', k);
        if (c < 0) return null;
        int i = c + 1;
        while (i < block.Length && char.IsWhiteSpace(block[i])) i++;
        int s = i;
        while (i < block.Length && char.IsDigit(block[i])) i++;
        return i > s ? block.Substring(s, i - s) : null;
    }

    static string FmtSize(long n)
    {
        if (n <= 0) return "-";
        if (n < 1024) return n + " B";
        if (n < 1024 * 1024) return (n / 1024.0).ToString("0.0") + " KB";
        return (n / (1024.0 * 1024.0)).ToString("0.00") + " MB";
    }

    /* Fill the file table from whichever version is selected. */
    void ShowVersionFiles()
    {
        if (lstFiles == null) return;
        lstFiles.Items.Clear();
        string ver = null;
        if (lstCloud != null && lstCloud.SelectedItems.Count > 0)
            ver = lstCloud.SelectedItems[0].SubItems[0].Text;
        if (ver == null || !cloudBlocks.ContainsKey(ver))
        {
            lblFiles.Text = "Files in the selected version:";
            return;
        }
        lblFiles.Text = "Files in " + ver + ":";
        foreach (var f in FilesOf(cloudBlocks[ver]))
        {
            lstFiles.Items.Add(new ListViewItem(new[]
            {
                f.What,
                f.Name,
                string.IsNullOrEmpty(f.Source) ? "-" : f.Source,
                FmtSize(f.Size),
                string.IsNullOrEmpty(f.Built) ? "-" : f.Built,
                string.IsNullOrEmpty(f.Sha) ? "-" : f.Sha.Substring(0, Math.Min(12, f.Sha.Length)),
            }));
        }
    }

    static IEnumerable<string> VersionBlocks(string json)
    {
        int v = json.IndexOf("\"versions\"");
        if (v < 0) yield break;
        int i = json.IndexOf('[', v);
        if (i < 0) yield break;
        while (true)
        {
            int start = json.IndexOf('{', i);
            if (start < 0) yield break;
            int depth = 0, end = -1;
            for (int k = start; k < json.Length; k++)
            {
                if (json[k] == '{') depth++;
                else if (json[k] == '}') { depth--; if (depth == 0) { end = k; break; } }
            }
            if (end < 0) yield break;
            yield return json.Substring(start, end - start + 1);
            i = end + 1;
        }
    }

    static string ValueOf(string block, string key)
    {
        int k = block.IndexOf("\"" + key + "\"");
        if (k < 0) return null;
        int c = block.IndexOf(':', k);
        if (c < 0) return null;
        int q1 = block.IndexOf('"', c + 1);
        if (q1 < 0) return null;
        int q2 = q1 + 1;
        while (q2 < block.Length && !(block[q2] == '"' && block[q2 - 1] != '\\')) q2++;
        return block.Substring(q1 + 1, q2 - q1 - 1);
    }

    /* Take a release out of a company's cloud list. The files it alone used
     * are deleted too, the manifest is re-signed and pushed - all by
     * tools\remove_version.ps1, so it behaves exactly like publishing. */
    /* Is the firmware just put into a folder (or an app) actually published
     * for this company? Compared by SHA-256 against every version in their
     * channel. A folder is allowed to carry unpublished firmware - that is
     * what offline delivery is - but shipping a build that was withdrawn from
     * the cloud is worth a plain warning rather than silence. */
    void WarnIfNotPublished(string channel, string who, string dir, Action<string> log)
    {
        try
        {
            string man = channel == "default"
                ? Path.Combine(FirmwareDir, "manifest.json")
                : Path.Combine(FirmwareDir, "customers", channel, "manifest.json");
            if (!File.Exists(man)) return;

            var published = new HashSet<string>();
            int versions = 0;
            foreach (string block in VersionBlocks(File.ReadAllText(man)))
            {
                versions++;
                foreach (var f in FilesOf(block))
                    if (!string.IsNullOrEmpty(f.Sha)) published.Add(f.Sha.ToLowerInvariant());
            }

            var strangers = new List<string>();
            string mainDir = Path.Combine(dir, "main_firmware");
            if (Directory.Exists(mainDir))
                foreach (string f in Directory.GetFiles(mainDir, "*.bin"))
                    if (!published.Contains(Sha256(f).ToLowerInvariant()))
                        strangers.Add(Path.GetFileName(f));

            if (versions == 0)
            {
                log("   !! " + who + " has NOTHING published in the cloud right now, yet this");
                log("      folder installs firmware. If it was withdrawn, do not send this folder.");
            }
            else if (strangers.Count > 0)
            {
                log("   !  not published for " + who + ": " + string.Join(", ", strangers.ToArray()));
                log("      (fine for an offline delivery - but if it was withdrawn, do not send it)");
            }
        }
        catch (Exception ex) { log("   ! could not compare with the cloud: " + ex.Message); }
    }

    /* Which files of a published version are ALSO sitting inside a company's
     * app. Matched by SHA-256, never by name: the app names its copies after
     * the day they were put in, so the same binary lives under two different
     * names and a name comparison would always say "no". */
    List<string> FirmwareAlsoInApp(string version, string appDir)
    {
        var hit = new List<string>();
        try
        {
            if (!cloudBlocks.ContainsKey(version) || !Directory.Exists(appDir)) return hit;
            var want = new HashSet<string>();
            foreach (var f in FilesOf(cloudBlocks[version]))
                if (!string.IsNullOrEmpty(f.Sha) && f.What != "Licence") want.Add(f.Sha.ToLowerInvariant());
            if (want.Count == 0) return hit;

            foreach (string sub in new[] { "main_firmware", "cloud_firmware" })
            {
                string d = Path.Combine(appDir, sub);
                if (!Directory.Exists(d)) continue;
                foreach (string f in Directory.GetFiles(d, "*.bin"))
                    if (want.Contains(Sha256(f).ToLowerInvariant()))
                        hit.Add(sub + "\\" + Path.GetFileName(f));
            }
        }
        catch (Exception ex) { Log("   ! could not check the app's firmware: " + ex.Message); }
        return hit;
    }

    /* Empty an app's built-in firmware. A half set is not installable, so it
     * goes as one: the binaries, the list the phone reads, and the receipt.
     * The service worker drops what builtin.json no longer names, so phones
     * let go of their stored copy on the next start with internet. */
    void ClearBuiltIn(string appDir, string who)
    {
        try
        {
            int n = 0;
            foreach (string sub in new[] { "main_firmware", "cloud_firmware" })
            {
                string d = Path.Combine(appDir, sub);
                if (!Directory.Exists(d)) continue;
                foreach (string f in Directory.GetFiles(d, "*.bin")) { File.Delete(f); n++; }
            }
            WriteBuiltinList(appDir, null);
            string rec = Path.Combine(appDir, "firmware_receipt.json");
            if (File.Exists(rec)) File.Delete(rec);
            Log("   " + who + "'s app: " + n + " built-in firmware file(s) removed.");
            /* Removing it here changes nothing for a phone until the app is
             * published - and this is the case where that matters most: the
             * firmware was withdrawn, so it must stop being handed out. */
            DeployApp(who + " app: withdrawn firmware removed", null);
        }
        catch (Exception ex) { Log("   ! could not empty the app's firmware: " + ex.Message); }
    }

    void RemoveSelected()
    {
        if (lstCloud.SelectedItems.Count == 0)
        {
            MessageBox.Show("Pick the version to remove from the list.", "Nothing selected");
            return;
        }
        string ver = lstCloud.SelectedItems[0].SubItems[0].Text;
        if (ver.StartsWith("(")) return;
        string channel = SelectedChannel();
        string who = channel == "default" ? "General" : Pretty(channel);

        bool isLast = lstCloud.Items.Count == 1;
        string warn = "Remove " + ver + " from " + who + "?\n\n" +
                      "It disappears from their updater and its files are deleted.\n" +
                      "Controllers already updated are NOT affected.";
        if (isLast)
            warn += "\n\nThis is their LAST version - " + who + " will have nothing to " +
                    "download until you publish again.";

        /* Taking a release off the cloud does NOT touch the copies that are
         * kept for working without internet: the same binaries sit inside the
         * company's app (phones) and inside every folder already sent. If the
         * release was withdrawn because it was bad, those keep installing it.
         * Find out BEFORE removing, while the manifest still describes it. */
        string appDirOfCompany = channel == "default" ? AppDir : Path.Combine(AppDir, "c\\" + channel);
        var alsoInApp = FirmwareAlsoInApp(ver, appDirOfCompany);
        if (alsoInApp.Count > 0)
            warn += "\n\nTHE SAME FIRMWARE IS ALSO INSIDE " + who.ToUpperInvariant() + "'S APP:\n" +
                    "   " + string.Join("\n   ", alsoInApp.ToArray()) + "\n" +
                    "Phones install that copy with no internet, so removing it from the\n" +
                    "cloud alone does not stop it. You will be asked about it next.";
        if (MessageBox.Show(warn, "Remove version", MessageBoxButtons.OKCancel,
                            MessageBoxIcon.Warning) != DialogResult.OK) return;

        bool clearApp = false;
        if (alsoInApp.Count > 0)
        {
            clearApp = MessageBox.Show(
                "Also take this firmware OUT of " + who + "'s app?\n\n" +
                "Yes - the app's built-in firmware is emptied, and phones drop their\n" +
                "stored copy on the next start with internet. They can still update\n" +
                "from the cloud. Put new firmware in with FIRMWARE INSIDE THE APP.\n\n" +
                "No - the app keeps installing this firmware offline.\n\n" +
                "(Folders already sent to " + who + " keep their copy either way -\n" +
                "there is no way to reach those; rebuild and resend them.)",
                "Firmware inside the app", MessageBoxButtons.YesNo,
                MessageBoxIcon.Warning) == DialogResult.Yes;
        }

        Busy(true);
        new Thread(() =>
        {
            try
            {
                Status("Removing " + ver + "...");
                var a = new StringBuilder();
                a.Append("-Version ").Append(Q(ver));
                if (channel != "default") a.Append(" -Customer ").Append(channel);
                int rc = RunPs("remove_version.ps1", a.ToString());
                if (rc == 0 && clearApp) ClearBuiltIn(appDirOfCompany, who);
                Status(rc == 0 ? ver + " removed." : "Remove failed - see the log.");
                BeginInvoke((Action)LoadCloudList);
            }
            catch (Exception ex) { Log("ERROR: " + ex.Message); }
            finally { Busy(false); }
        }) { IsBackground = true }.Start();
    }

    void RefreshFingerprints()
    {
        lblCtrlFp.Text = FileFp(txtCtrl.Text);
        lblSysFp.Text = chkSystem.Checked ? FileFp(txtSys.Text) : "(not included)";
        lblEspFp.Text = chkEsp.Checked ? EspFp(txtEsp.Text) : "(not included)";
    }

    static string FileFp(string path)
    {
        try
        {
            if (string.IsNullOrEmpty(path) || !File.Exists(path)) return "file not found";
            var fi = new FileInfo(path);
            return string.Format("last modified {0:dddd d MMMM yyyy  HH:mm}      {1:N0} bytes",
                                 fi.LastWriteTime, fi.Length);
        }
        catch (Exception ex) { return "could not read (" + ex.Message + ")"; }
    }

    static string EspFp(string dir)
    {
        try
        {
            string f = Path.Combine(dir ?? "", "firmware.bin");
            if (!File.Exists(f)) return "firmware.bin not found in this folder";
            var fi = new FileInfo(f);
            return string.Format("firmware.bin last modified {0:dddd d MMMM yyyy  HH:mm}      {1:N0} bytes",
                                 fi.LastWriteTime, fi.Length);
        }
        catch (Exception ex) { return "could not read (" + ex.Message + ")"; }
    }

    Button Mk(string text, int x, int y, int w, EventHandler onClick)
    {
        var b = new Button { Left = x, Top = y, Width = w, Height = 26, Text = text, UseVisualStyleBackColor = true };
        b.Click += onClick;
        Controls.Add(b);
        return b;
    }

    // same, argument order matching the right-anchored buttons below
    Button Mk(int x, int y, int w, string text, EventHandler onClick) { return Mk(text, x, y, w, onClick); }

    void Browse(TextBox target, string filter)
    {
        using (var d = new OpenFileDialog { Filter = filter + "|All files|*.*" })
        {
            try { if (target.Text.Length > 0) d.InitialDirectory = Path.GetDirectoryName(target.Text); } catch { }
            if (d.ShowDialog() == DialogResult.OK) target.Text = d.FileName;
        }
    }

    /* Remembered in the user profile, never inside the app folder - a stray
     * settings file would otherwise be copied into customer folders. */
    static string DestFile()
    {
        string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "GATA");
        Directory.CreateDirectory(dir);
        return Path.Combine(dir, "release_manager_dest.txt");
    }

    static string LoadDestPath()
    {
        try { if (File.Exists(DestFile())) return File.ReadAllText(DestFile()).Trim(); } catch { }
        return @"D:\";
    }

    static void SaveDestPath(string p)
    {
        try { File.WriteAllText(DestFile(), p); } catch { }
    }

    /* A path box with a Browse button - so a path can be pasted instead of
     * clicked through. Returns null when cancelled. */
    static string PromptPath(string title, string label, string preset)
    {
        using (var f = new Form { Text = title, Size = new Size(660, 190), StartPosition = FormStartPosition.CenterParent,
                                  FormBorderStyle = FormBorderStyle.FixedDialog, MaximizeBox = false, MinimizeBox = false })
        {
            var l = new Label { Left = 16, Top = 16, Width = 610, Height = 34, Text = label };
            var t = new TextBox { Left = 16, Top = 56, Width = 510, Text = preset ?? "" };
            var br = new Button { Text = "Browse...", Left = 534, Top = 55, Width = 92 };
            br.Click += (s, e) =>
            {
                using (var d = new FolderBrowserDialog { SelectedPath = Directory.Exists(t.Text) ? t.Text : @"D:\" })
                    if (d.ShowDialog() == DialogResult.OK) t.Text = d.SelectedPath;
            };
            var ok = new Button { Text = "OK", Left = 442, Top = 104, Width = 84, DialogResult = DialogResult.OK };
            var no = new Button { Text = "Cancel", Left = 534, Top = 104, Width = 92, DialogResult = DialogResult.Cancel };
            f.Controls.AddRange(new Control[] { l, t, br, ok, no });
            f.AcceptButton = ok; f.CancelButton = no;
            return f.ShowDialog() == DialogResult.OK ? t.Text.Trim().Trim('"') : null;
        }
    }

    void BrowseFolder(TextBox target)
    {
        using (var d = new FolderBrowserDialog { SelectedPath = Directory.Exists(target.Text) ? target.Text : AppDir })
            if (d.ShowDialog() == DialogResult.OK) target.Text = d.SelectedPath;
    }

    /* Dialogs raised from a worker thread have no owner: Windows can put them
     * BEHIND the main window, and since the buttons are disabled while the job
     * runs, the program looks frozen while it is really waiting for an answer
     * nobody can see. Always ask on the UI thread, owned by this window. */
    DialogResult Ask(string text, string title, MessageBoxButtons buttons, MessageBoxIcon icon)
    {
        if (InvokeRequired)
            return (DialogResult)Invoke(new Func<DialogResult>(
                () => MessageBox.Show(this, text, title, buttons, icon)));
        return MessageBox.Show(this, text, title, buttons, icon);
    }

    void Log(string s)
    {
        if (txtLog.InvokeRequired) { txtLog.BeginInvoke((Action)(() => Log(s))); return; }
        txtLog.AppendText(s + Environment.NewLine);
    }

    void Status(string s)
    {
        if (lblStatus.InvokeRequired) { lblStatus.BeginInvoke((Action)(() => Status(s))); return; }
        lblStatus.Text = s;
    }

    void Busy(bool on)
    {
        if (InvokeRequired) { BeginInvoke((Action)(() => Busy(on))); return; }
        bar.Visible = on;
        btnPublish.Enabled = btnBuildFolder.Enabled = btnNewCompany.Enabled = btnBackup.Enabled = !on;
        if (btnApk != null) btnApk.Enabled = !on;
        if (btnRemove != null) btnRemove.Enabled = !on;
        Cursor = on ? Cursors.WaitCursor : Cursors.Default;
    }

    // Channels = the shared "default" plus every folder in firmware\customers.
    void LoadCustomers()
    {
        string keep = cboCustomer.SelectedItem as string;
        cboCustomer.Items.Clear();
        cboCustomer.Items.Add("General  (channel: default)");
        try
        {
            string dir = Path.Combine(FirmwareDir, "customers");
            if (Directory.Exists(dir))
                foreach (var d in Directory.GetDirectories(dir).OrderBy(x => x))
                {
                    string id = Path.GetFileName(d);
                    cboCustomer.Items.Add(Pretty(id) + "  (channel: " + id + ")");
                }
        }
        catch (Exception ex) { Log("Could not read customer channels: " + ex.Message); }
        if (keep != null && cboCustomer.Items.Contains(keep)) cboCustomer.SelectedItem = keep;
        else if (cboCustomer.Items.Count > 0) cboCustomer.SelectedIndex = 0;
    }

    static string Pretty(string id)
    {
        if (id.Equals("ksp", StringComparison.OrdinalIgnoreCase)) return "KSP";
        if (id.Length == 0) return id;
        return char.ToUpper(id[0]) + id.Substring(1);
    }

    string SelectedChannel()
    {
        string s = cboCustomer.SelectedItem as string;
        if (string.IsNullOrEmpty(s)) return "default";
        int i = s.IndexOf("channel: ");
        return i < 0 ? "default" : s.Substring(i + 9).TrimEnd(')', ' ');
    }

    void FillDefaultPaths()
    {
        txtCtrl.Text = Path.Combine(RepoRoot, @"g_500\Debug\NPC20_mini.bin");
        txtSys.Text = Path.Combine(RepoRoot, @"USBupdaterCode_relbuild\Debug\Booster_phase.bin");
        txtEsp.Text = Path.Combine(RepoRoot, @"esp\.pio\build\esp32dev");
        foreach (var t in new[] { txtCtrl, txtSys, txtEsp })
            if (!File.Exists(t.Text) && !Directory.Exists(t.Text)) t.BackColor = Color.FromArgb(255, 244, 244);
    }

    // Run a PowerShell script and stream its output into the log.
    int RunPs(string script, string argLine)
    {
        string baseStatus = lblStatus.Text.Length > 0 ? lblStatus.Text : "Working...";
        string cmd = "powershell -NoProfile -ExecutionPolicy Bypass -File \"" +
                     Path.Combine(ToolsDir, script) + "\" " + argLine;
        Log("");
        Log("> " + cmd);
        var psi = new ProcessStartInfo("powershell.exe",
            "-NoProfile -ExecutionPolicy Bypass -File \"" + Path.Combine(ToolsDir, script) + "\" " + argLine)
        {
            WorkingDirectory = ToolsDir,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8
        };
        using (var p = new Process { StartInfo = psi })
        {
            p.OutputDataReceived += (s, e) => { if (e.Data != null) Log("   " + e.Data); };
            p.ErrorDataReceived += (s, e) => { if (e.Data != null) Log("   ! " + e.Data); };
            p.Start();
            p.BeginOutputReadLine();
            p.BeginErrorReadLine();
            /* Bounded wait: the parameterless WaitForExit() also waits for the
             * output pipes, which a stray grandchild process (a Java/Gradle
             * helper, say) can hold open long after the work is done - the
             * window would sit there looking dead. Wait for the PROCESS, then
             * give the last lines a moment to arrive. */
            var clock = Stopwatch.StartNew();
            while (!p.WaitForExit(1000))
            {
                Status(baseStatus + "  (" + (int)clock.Elapsed.TotalSeconds + " s)");
                if (clock.Elapsed.TotalMinutes > 30)
                {
                    Log("   ! still running after 30 minutes - stopping it");
                    try { p.Kill(); } catch { }
                    return -1;
                }
            }
            Thread.Sleep(300);
            return p.ExitCode;
        }
    }

    static string Q(string s) { return "\"" + s + "\""; }

    // ---------------------------------------------------------------- publish
    void Publish()
    {
        string channel = SelectedChannel();
        var boards = new List<string>();
        if (chkRev5.Checked) boards.Add("rev5");
        if (chkRev6.Checked) boards.Add("rev6");

        if (boards.Count == 0) { MessageBox.Show("Pick at least one board.", "Nothing to publish"); return; }
        if (!File.Exists(txtCtrl.Text)) { MessageBox.Show("Controller software file not found:\n" + txtCtrl.Text, "File missing"); return; }
        if (chkSystem.Checked && !File.Exists(txtSys.Text)) { MessageBox.Show("System firmware file not found:\n" + txtSys.Text, "File missing"); return; }
        if (chkEsp.Checked && !Directory.Exists(txtEsp.Text)) { MessageBox.Show("ESP32 build folder not found:\n" + txtEsp.Text, "Folder missing"); return; }

        string who = Pretty(channel == "default" ? "General" : channel);

        /* An app holds ONE controller binary, so if both boards are being
         * published the firmware inside the app has to be one of them. */
        string inAppBoard = null;
        if (chkInApp.Checked)
        {
            inAppBoard = boards.Count == 1 ? boards[0] : AskBoard("An app");
            if (inAppBoard == null) return;
        }

        string appLine = chkInApp.Checked
            ? "The same firmware also goes INSIDE " + who + "'s app (" + inAppBoard + "),\n" +
              "so their phone can install it with no internet."
            : "Their app will carry NO firmware - anything already inside it is\n" +
              "removed, and they download from the cloud every time.";

        if (MessageBox.Show("Publish for " + who + " (" + string.Join(" + ", boards) + ")?\n\n" +
                            "This uploads to the cloud and every " + who + " updater will see it.\n\n" +
                            appLine,
                            "Publish", MessageBoxButtons.OKCancel, MessageBoxIcon.Question) != DialogResult.OK) return;

        Busy(true);
        new Thread(() =>
        {
            try
            {
                foreach (string board in boards)
                {
                    Status("Publishing " + board + " for " + who + "...");
                    var a = new StringBuilder();
                    a.Append("-Board ").Append(board);
                    if (channel != "default") a.Append(" -Customer ").Append(channel);
                    a.Append(" -Main ").Append(Q(txtCtrl.Text));
                    if (chkSystem.Checked) a.Append(" -System ").Append(Q(txtSys.Text));
                    /* Unticked means the release carries NO cloud-module
                     * firmware. -NoEsp is required for that: with neither
                     * flag the publisher quietly reuses the ESP files already
                     * on the server, and the release would ship them after
                     * all. */
                    if (chkEsp.Checked) a.Append(" -EspDir ").Append(Q(txtEsp.Text));
                    else a.Append(" -NoEsp");
                    if (txtNotes.Text.Trim().Length > 0) a.Append(" -Notes ").Append(Q(txtNotes.Text.Trim().Replace("\"", "'")));

                    int rc = RunPs("publish_firmware.ps1", a.ToString());
                    if (rc != 0) { Status("FAILED for " + board + " - see the log."); Busy(false); return; }
                }
                /* The firmware inside the app, from the same tick that chose it
                 * - written AND published, so nothing is left half-done. */
                ApplyFirmwareInsideApp(channel, who, inAppBoard, null);

                Status("Published. Customers see it on their next start.");
                BeginInvoke((Action)LoadCloudList);
                Log("");
                Log("=== DONE. Published for " + who + ": " + string.Join(", ", boards) + " ===");
                Log(chkInApp.Checked
                    ? "   their app carries this firmware too - it installs with no internet."
                    : "   their app carries NO firmware - they download from the cloud each time.");
            }
            catch (Exception ex) { Log("ERROR: " + ex.Message); Status("Failed - see the log."); }
            finally { Busy(false); }
        }) { IsBackground = true }.Start();
    }

    // ------------------------------------------------- build customer folder
    void BuildFolder()
    {
        string channel = SelectedChannel();
        string who = channel == "default" ? "General" : Pretty(channel);

        string licFile = FindLicenseFile(channel);
        if (licFile == null)
        {
            MessageBox.Show("No license file found for " + who + ".\n\n" +
                            "Make one first: 'Add new company...' creates the channel and the license,\n" +
                            "or run tools\\make_license.ps1 for an existing channel.",
                            "License missing", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        /* One folder per board: a rev 5 folder must carry rev 5 firmware and a
         * rev 6 folder rev 6 firmware, so the board tick boxes decide what is
         * built - ticking both makes both folders. */
        var boards = new List<string>();
        if (chkRev5.Checked) boards.Add("rev5");
        if (chkRev6.Checked) boards.Add("rev6");
        if (boards.Count == 0)
        {
            MessageBox.Show("Tick which board this uploader is for (rev 5, rev 6, or both).", "Pick a board");
            return;
        }

        string parent = (txtDest.Text ?? "").Trim().Trim('"');
        if (parent.Length == 0)
        {
            MessageBox.Show("Type or paste the folder where the customer folder should be created\n" +
                            "(the \"Put customer folders in\" box above).", "Where to?");
            txtDest.Focus();
            return;
        }
        try
        {
            if (!Directory.Exists(parent)) Directory.CreateDirectory(parent);
        }
        catch (Exception ex)
        {
            MessageBox.Show("Cannot use that folder:\n\n" + parent + "\n\n" + ex.Message, "Where to?");
            txtDest.Focus();
            return;
        }
        SaveDestPath(parent);

        Busy(true);
        new Thread(() =>
        {
            try
            {
                var made = new List<string>();
                var allProblems = new List<string>();
                foreach (string board in boards)
                {
                    string dest = Path.Combine(parent, "Uploader_" + who.Replace(" ", "_") + "_" + board);
                    Status("Building " + board + "...");
                    /* The system firmware always goes in: the updater needs it
                     * for EVERY action (it is what a controller with very old
                     * software is recovered with), so a folder without it
                     * fails on the first step. The tick box only decides
                     * whether a NEW system firmware is PUBLISHED.
                     * The cloud module is genuinely optional - boards without
                     * an ESP32 do not need it. */
                    var problems = BuildFolderCore(channel, dest, board,
                        txtCtrl.Text,
                        txtSys.Text,
                        chkEsp.Checked ? txtEsp.Text : null,
                        Log);
                    if (problems.Count > 0) allProblems.AddRange(problems);
                    else { made.Add(dest); lastBuiltFolder = dest; }
                }
                if (allProblems.Count > 0)
                {
                    Status("Problems found - see the log.");
                    Ask("Not everything is ready to send:\n\n" +
                                    string.Join("\n\n", allProblems.ToArray()),
                                    "Check failed", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    if (made.Count == 0) return;
                }
                Status("Done - " + made.Count + " folder(s) ready to send.");
                if (made.Count > 0 &&
                    Ask("Ready:\n\n" + string.Join("\n", made.ToArray()) + "\n\nOpen now?", "Done",
                                    MessageBoxButtons.YesNo, MessageBoxIcon.Information) == DialogResult.Yes)
                    Process.Start("explorer.exe", "\"" + made[0] + "\"");
            }
            catch (Exception ex) { Log("ERROR: " + ex.Message); Status("Failed - see the log."); }
            finally { Busy(false); }
        }) { IsBackground = true }.Start();
    }

    /* The actual folder build - shared by the button and by /buildfolder, so
     * what is tested from the command line is exactly what the button does.
     * Returns the list of problems found (empty = good to send). */
    public List<string> BuildFolderCore(string channel, string dest, string board,
                                        string ctrlPath, string sysPath, string espDir, Action<string> log)
    {
        string who = channel == "default" ? "General" : Pretty(channel);
        string licFile = FindLicenseFile(channel);
        var problems = new List<string>();

        log("=== Building " + dest + "   (" + board + ") ===");
        if (licFile == null) { problems.Add("MISSING: no license file for channel '" + channel + "'"); return problems; }

        /* Rebuilding on top of an older folder would leave its stale files
         * behind (an old firmware .bin, or junk from a previous version of
         * this tool). Clear it first - but ONLY when it really is a previously
         * built uploader folder, never an arbitrary folder someone picked. */
        if (Directory.Exists(dest))
        {
            bool empty = Directory.GetFileSystemEntries(dest).Length == 0;
            /* ANY of these means the folder is one of ours. Requiring BOTH
             * index.html and the launcher meant a folder left half-built by a
             * failed run - index.html already deleted - was refused for ever
             * as "not an uploader folder", with no way forward but deleting it
             * by hand. */
            bool isUploader = false;
            foreach (string mark in new[] { "index.html", "CLICK_ME_START_ON_PC.bat",
                                            "GATA_Updater.exe", "builtin.json",
                                            "firmware_receipt.json", "gata.license",
                                            "FIRMWARE_INFO.txt", "app.webmanifest" })
                if (File.Exists(Path.Combine(dest, mark))) { isUploader = true; break; }
            if (!empty && !isUploader)
            {
                problems.Add("The folder already exists and does not look like an uploader folder: " + dest);
                log("   !! refusing to overwrite " + dest);
                return problems;
            }
            if (!empty)
            {
                /* Check for a LOCKED file BEFORE deleting anything.
                 *
                 * Most often it is GATA_Updater.exe still serving the folder -
                 * exactly what somebody testing it would have running. The old
                 * code deleted what it could and swallowed the failures, so a
                 * locked file left the folder half-erased and the next attempt
                 * refused it as "not an uploader folder". Nothing is removed
                 * now unless all of it can be. */
                var locked = new List<string>();
                foreach (string f in Directory.GetFiles(dest, "*", SearchOption.AllDirectories))
                {
                    try { using (File.Open(f, FileMode.Open, FileAccess.ReadWrite, FileShare.None)) { } }
                    catch (IOException) { locked.Add(f.Substring(dest.Length).TrimStart('\\')); }
                    catch (UnauthorizedAccessException) { /* read-only attribute - still deletable */ }
                }
                if (locked.Count > 0)
                {
                    problems.Add("Something in that folder is open, so it cannot be rebuilt:");
                    foreach (string l in locked) problems.Add("   " + l);
                    problems.Add("Close the updater running from it (CLICK_ME_START_ON_PC / " +
                                 "GATA_Updater.exe) and any open file, then try again.");
                    problems.Add("Nothing was changed - the folder is exactly as it was.");
                    foreach (string p in problems) log("   !! " + p);
                    return problems;
                }

                foreach (string d in Directory.GetDirectories(dest))
                    try { Directory.Delete(d, true); }
                    catch (Exception ex) { log("   ! could not remove old " + Path.GetFileName(d) + ": " + ex.Message); }
                foreach (string f in Directory.GetFiles(dest))
                    try { File.Delete(f); } catch { }
                log("   previous contents cleared.");
            }
        }

        /* Only what a customer actually needs. Everything else is left out:
         * your keys and release scripts (tools\), the firmware server repo,
         * the Android keystore, tests, screenshots, the old per-customer
         * copies, and your internal notes. */
        CopyTree(AppDir, dest);
        log("   app files copied.");

        /* Out with the demo simulator. It exists to try the updater with no
         * hardware attached, which nobody receiving this folder needs - and it
         * spells out the controller's whole command set (INFO -> MCU:/BL:/
         * EXTERNAL_FLASH:, READY_FOR_DATA, PROGRESS:...), which is exactly what
         * the log was cleaned of. It is referenced in two places, and BOTH have
         * to go: the service worker fills its offline cache atomically, so one
         * missing file in that list would leave the folder with no offline
         * copy at all. */
        StripDemoSimulator(dest, log);

        /* tools\ is NOT copied wholesale (it holds signing_key.json and
         * license_key.json). The launcher needs exactly these few, so copy
         * just them - without this the .bat fails with
         * "the argument tools\serve.ps1 ... does not exist". */
        string custTools = Path.Combine(dest, "tools");
        Directory.CreateDirectory(custTools);
        foreach (string t in CustomerTools)
        {
            string src = Path.Combine(ToolsDir, t);
            if (File.Exists(src)) { File.Copy(src, Path.Combine(custTools, t), true); log("   tools\\" + t); }
            else log("   ! missing (skipped): tools\\" + t);
        }

        File.Copy(licFile, Path.Combine(dest, "gata.license"), true);
        log("   license: " + Path.GetFileName(licFile) + "  ->  gata.license");

        /* The Android app is per company too - it opens THEIR page, with their
         * licence, their channel and their own built-in firmware. Shipping the
         * shared General app in a KSP folder would put a KSP customer on the
         * General channel, so the wrong one is never copied: either theirs is
         * here, or the folder goes out without an app and says so. */
        /* No .apk in here. This folder is the PC updater; the phone app is a
         * separate delivery (dist\gata-updater[-<channel>].apk) and putting a
         * copy in was only confusing - the folder finishes instantly because
         * it never built one, so the apk it carried was whatever happened to
         * be lying in dist\ from some earlier run. */

        /* The offline files are simply the ones picked in the window. */
        int n = CopySelectedFirmware(dest, who, board, ctrlPath, sysPath, espDir, log);
        log("   firmware files put in the folder: " + n);

        /* A folder keeps its own copy so it works with no internet - which
         * also means it happily ships firmware that is NOT published for this
         * company, including a release that was withdrawn from the cloud. Say
         * so: the folder is still valid, but it is worth knowing. */
        WarnIfNotPublished(channel, who, dest, log);
        if (n == 0)
            problems.Add("No firmware files were copied - check the file paths in the window.");

        /* Prove the folder works before it is handed over: every script the
         * launcher calls must be present, the license must be there, and none
         * of your secrets may have leaked in. */
        foreach (string need in new[] { "index.html", "CLICK_ME_START_ON_PC.bat", "gata.license",
                                        @"tools\serve.ps1", @"tools\check_auto_connect.ps1",
                                        @"tools\enable_auto_connect.ps1", @"js\app.js", @"js\license.js" })
            if (!File.Exists(Path.Combine(dest, need))) problems.Add("MISSING: " + need);

        /* The two the updater cannot work without. (The cloud module is not
         * checked - a board without an ESP32 legitimately has none.) */
        string mainDirChk = Path.Combine(dest, "main_firmware");
        if (!Directory.Exists(mainDirChk) || Directory.GetFiles(mainDirChk, "controller*.bin").Length == 0)
            problems.Add("MISSING: main_firmware\\controller*.bin - the controller software");
        if (!Directory.Exists(mainDirChk) || Directory.GetFiles(mainDirChk, "system*.bin").Length == 0)
            problems.Add("MISSING: main_firmware\\system*.bin - the updater needs it for every action");
        foreach (string secret in new[] { @"tools\signing_key.json", @"tools\license_key.json",
                                          @"tools\driver_signing_key.pfx",
                                          @"tools\licenses_issued.txt", @"tools\publish_firmware.ps1",
                                          @"tools\make_license.ps1", "GATA_Release_Manager.exe" })
            if (File.Exists(Path.Combine(dest, secret))) problems.Add("MUST NOT BE THERE: " + secret);
        if (Directory.Exists(Path.Combine(dest, "firmware"))) problems.Add("MUST NOT BE THERE: firmware\\");
        if (Directory.Exists(Path.Combine(dest, "android"))) problems.Add("MUST NOT BE THERE: android\\");

        if (problems.Count > 0) { foreach (string p in problems) log("   !! " + p); return problems; }

        log("   check passed: launcher scripts present, no keys included.");
        log("=== DONE ===");
        log("Send the whole folder to " + who + " (for " + board + " boards). They run CLICK_ME_START_ON_PC.bat.");
        return problems;
    }

    string FindLicenseFile(string channel)
    {
        string dir = Path.Combine(ToolsDir, "licenses");
        if (!Directory.Exists(dir)) return null;
        // the file is named after the CUSTOMER; match by reading the token's channel
        foreach (var f in Directory.GetFiles(dir, "*.license"))
        {
            try
            {
                string tok = File.ReadAllText(f).Trim();
                string[] parts = tok.Split('.');
                if (parts.Length != 3) continue;
                string json = Encoding.UTF8.GetString(FromB64Url(parts[1]));
                string want = "\"channel\":\"" + channel + "\"";
                if (json.Replace(" ", "").Contains(want)) return f;
            }
            catch { }
        }
        return null;
    }

    static byte[] FromB64Url(string s)
    {
        s = s.Replace('-', '+').Replace('_', '/');
        switch (s.Length % 4) { case 2: s += "=="; break; case 3: s += "="; break; }
        return Convert.FromBase64String(s);
    }

    /* Put the files CHOSEN IN THE WINDOW into the customer folder, named with
     * the company and the board so nobody can mix them up later:
     *     main_firmware\controller_<dd_MM_yy>_<Company>_<rev>.bin
     *     main_firmware\system_<dd_MM_yy>_<Company>_<rev>.bin
     *     cloud_firmware\bootloader|partitions|boot_app0|firmware.bin
     * The ESP files keep their exact names - the app looks for those four. */
    /* builtin.json = "which firmware ships inside this app". It was being
     * copied from the source folder, so it named the SOURCE's binaries, which
     * do not exist here - masked on a PC because GATA_Updater.exe can list the
     * real directory, but fatal for a hosted site (a phone has no listing, so
     * the app would find no built-in firmware at all). Write it from what is
     * actually on disk. */
    public static void WriteBuiltinList(string dest, Action<string> log)
    {
        var sb = new StringBuilder();
        sb.AppendLine("{");
        sb.AppendLine("  \"note\": \"Firmware that ships with the app. The service worker stores these on the device at first run, so the updater also works with no internet.\",");
        string[] folders = { "main_firmware", "cloud_firmware" };
        for (int i = 0; i < folders.Length; i++)
        {
            string dir = Path.Combine(dest, folders[i]);
            var files = Directory.Exists(dir)
                ? Directory.GetFiles(dir, "*.bin").OrderBy(f => Path.GetFileName(f)).ToArray()
                : new string[0];
            sb.AppendLine("  \"" + folders[i] + "\": [");
            for (int k = 0; k < files.Length; k++)
                sb.AppendLine("    { \"name\": \"" + Path.GetFileName(files[k]) + "\", \"size\": " +
                              new FileInfo(files[k]).Length + " }" + (k < files.Length - 1 ? "," : ""));
            sb.AppendLine("  ]" + (i < folders.Length - 1 ? "," : ""));
        }
        sb.AppendLine("}");
        File.WriteAllText(Path.Combine(dest, "builtin.json"), sb.ToString(), new UTF8Encoding(false));
        if (log != null) log("      builtin.json  (what the phone stores for offline use)");
    }

    int CopySelectedFirmware(string dest, string company, string board,
                             string ctrlPath, string sysPath, string espDir, Action<string> log)
    {
        string mainDir = Path.Combine(dest, "main_firmware");
        string cloudDir = Path.Combine(dest, "cloud_firmware");
        Directory.CreateDirectory(mainDir);
        Directory.CreateDirectory(cloudDir);
        foreach (var f in Directory.GetFiles(mainDir, "*.bin")) File.Delete(f);   // no stale mixes
        foreach (var f in Directory.GetFiles(cloudDir, "*.bin")) File.Delete(f);

        string tag = DateTime.Now.ToString("dd_MM_yy") + "_" +
                     new string(company.Where(c => char.IsLetterOrDigit(c)).ToArray()) + "_" + board;
        int n = 0;
        /* A RECEIPT of what went in: every file with its SHA-256, written next
         * to the firmware. The app re-hashes the files it is about to install
         * and compares them with this - so "is this really the firmware I put
         * in?" is answered by arithmetic, not by trust. The copy is verified
         * here too: a copy that did not land byte-for-byte is caught now. */
        var receipt = new StringBuilder();
        receipt.Append("{\n  \"company\": \"").Append(company).Append("\",\n");
        receipt.Append("  \"board\": \"").Append(board).Append("\",\n");
        receipt.Append("  \"built\": \"").Append(DateTime.Now.ToString("yyyy-MM-dd HH:mm")).Append("\",\n");
        receipt.Append("  \"files\": {\n");
        var lines = new List<string>();
        var built = new List<string>();

        Action<string, string, string> put = (srcPath, folder, destName) =>
        {
            string destPath = Path.Combine(Path.Combine(dest, folder), destName);
            File.Copy(srcPath, destPath, true);
            string srcHash = Sha256(srcPath), dstHash = Sha256(destPath);
            if (srcHash != dstHash)
            {
                log("      !! COPY MISMATCH for " + destName + " - do not send this folder");
                return;
            }
            lines.Add("    \"" + folder + "/" + destName + "\": \"" + dstHash + "\"");
            /* The moment the compiler produced this .bin. Windows keeps the
             * last-write time through a copy, so it still says when the
             * firmware was BUILT, not when it was packed. Metadata only - the
             * fingerprint above is what is actually enforced. */
            built.Add("    \"" + folder + "/" + destName + "\": \"" +
                      File.GetLastWriteTime(srcPath).ToString("yyyy-MM-dd HH:mm") + "\"");
            log("      " + folder + "\\" + destName + "   [" + dstHash.Substring(0, 12) + "]" +
                "   built " + File.GetLastWriteTime(srcPath).ToString("yyyy-MM-dd HH:mm"));
            n++;
        };

        if (!string.IsNullOrEmpty(ctrlPath) && File.Exists(ctrlPath))
            put(ctrlPath, "main_firmware", "controller_" + tag + ".bin");
        if (!string.IsNullOrEmpty(sysPath) && File.Exists(sysPath))
            put(sysPath, "main_firmware", "system_" + tag + ".bin");
        if (!string.IsNullOrEmpty(espDir) && Directory.Exists(espDir))
            foreach (string part in new[] { "bootloader.bin", "partitions.bin", "boot_app0.bin", "firmware.bin" })
            {
                string src = Path.Combine(espDir, part);
                if (!File.Exists(src)) { log("      ! missing ESP file: " + part); continue; }
                put(src, "cloud_firmware", part);
            }

        receipt.Append(string.Join(",\n", lines.ToArray())).Append("\n  },\n");
        receipt.Append("  \"built_times\": {\n").Append(string.Join(",\n", built.ToArray())).Append("\n  }\n}\n");
        File.WriteAllText(Path.Combine(dest, "firmware_receipt.json"), receipt.ToString(), new UTF8Encoding(false));

        WriteBuiltinList(dest, log);

        /* The same thing in plain words, so it can be checked by opening a
         * text file - no tools needed. */
        var txt = new StringBuilder();
        txt.AppendLine("GATA firmware delivery - what is inside this uploader");
        txt.AppendLine("=====================================================");
        txt.AppendLine("Company : " + company);
        txt.AppendLine("Board   : " + board);
        txt.AppendLine("Prepared: " + DateTime.Now.ToString("yyyy-MM-dd HH:mm"));
        txt.AppendLine();
        txt.AppendLine("These are the exact firmware files that were put in. The updater");
        txt.AppendLine("re-checks every one of them before installing and REFUSES to install");
        txt.AppendLine("a file whose fingerprint does not match this list.");
        txt.AppendLine();
        for (int i = 0; i < lines.Count; i++)
        {
            string t = lines[i].Trim().TrimStart('"');
            int q = t.IndexOf("\": \"");
            if (q < 0) continue;
            txt.AppendLine("  " + t.Substring(0, q));
            txt.AppendLine("      fingerprint " + t.Substring(q + 4).TrimEnd('"'));
            if (i < built.Count)
            {
                string bt = built[i].Trim().TrimStart('"');
                int bq = bt.IndexOf("\": \"");
                if (bq >= 0) txt.AppendLine("      built       " + bt.Substring(bq + 4).TrimEnd('"'));
            }
        }
        txt.AppendLine();
        txt.AppendLine("Source files these came from (on the release PC):");
        if (!string.IsNullOrEmpty(ctrlPath)) txt.AppendLine("  controller : " + ctrlPath);
        if (!string.IsNullOrEmpty(sysPath)) txt.AppendLine("  system     : " + sysPath);
        if (!string.IsNullOrEmpty(espDir)) txt.AppendLine("  cloud mod. : " + espDir);
        File.WriteAllText(Path.Combine(dest, "FIRMWARE_INFO.txt"), txt.ToString(), new UTF8Encoding(false));

        log("      firmware_receipt.json + FIRMWARE_INFO.txt  (the updater checks the files against these)");
        return n;
    }

    /* "Is the firmware I chose really the one in that folder?" - answered by
     * re-hashing: the folder's files vs its receipt, AND vs the files
     * currently selected in this window. */
    /* Re-hash every firmware file a folder was delivered with and compare it
     * with the receipt. Faults are appended to `bad`; the return value is how
     * many files were verified clean.
     *
     * ONLY the "files" object is read. The receipt also carries
     * "built_times", whose keys are the SAME file names but whose values are
     * dates - read as hashes those never matched, so a perfectly good folder
     * was reported as six changed files and the button said "do not send this
     * folder". Whitespace-tolerant too: the receipt written by PowerShell
     * spaces its colons differently from the one written here. */
    public static int CheckReceipt(string dest, Action<string> log, List<string> bad)
    {
        string rec = Path.Combine(dest, "firmware_receipt.json");
        if (!File.Exists(rec)) { bad.Add("no firmware_receipt.json"); return 0; }
        string filesObj = ObjectOf(File.ReadAllText(rec), "files");
        if (filesObj == null) { bad.Add("the receipt has no file list"); return 0; }

        int okCount = 0;
        var listed = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (Match m in Regex.Matches(filesObj,
                 "\"((?:main_firmware|cloud_firmware)/[^\"]+)\"\\s*:\\s*\"([0-9a-fA-F]{64})\""))
        {
            string rel = m.Groups[1].Value, want = m.Groups[2].Value;
            listed.Add(rel.Replace('/', '\\'));
            string path = Path.Combine(dest, rel.Replace('/', '\\'));
            if (!File.Exists(path)) { bad.Add(rel + " - MISSING"); continue; }
            string got = Sha256(path);
            if (!string.Equals(got, want, StringComparison.OrdinalIgnoreCase))
                bad.Add(rel + " - CHANGED (" + got.Substring(0, 12) + " instead of " + want.Substring(0, 12) + ")");
            else { okCount++; if (log != null) log("   ok  " + rel + "   [" + got.Substring(0, 12) + "]"); }
        }
        /* A binary nobody put there is as wrong as a changed one: it would be
         * offered for installation with nothing vouching for it. */
        foreach (string sub in new[] { "main_firmware", "cloud_firmware" })
        {
            string d = Path.Combine(dest, sub);
            if (!Directory.Exists(d)) continue;
            foreach (string f in Directory.GetFiles(d, "*.bin"))
                if (!listed.Contains(sub + "\\" + Path.GetFileName(f)))
                    bad.Add(sub + "\\" + Path.GetFileName(f) + " - NOT on the receipt");
        }
        return okCount;
    }

    void CheckFolder()
    {
        string dest = PromptPath("Check a folder",
            "Paste (or browse to) the customer uploader folder to check:",
            lastBuiltFolder ?? LoadDestPath());
        if (string.IsNullOrEmpty(dest)) return;
        if (!Directory.Exists(dest))
        {
            MessageBox.Show("That folder does not exist:\n\n" + dest, "Check a folder");
            return;
        }

        Log("");
        Log("=== Checking " + dest + " ===");
        string rec = Path.Combine(dest, "firmware_receipt.json");
        if (!File.Exists(rec))
        {
            Log("   !! no firmware_receipt.json - this folder was built by an older version.");
            MessageBox.Show("This folder has no delivery receipt (built with an older version).\n\n" +
                            "Build it again so its firmware can be checked.", "Cannot check",
                            MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        var bad = new List<string>();
        int checkedCount = CheckReceipt(dest, Log, bad);

        // ...and does it match what is selected in the window right now?
        var differs = new List<string>();
        Action<string, string> cmp = (srcPath, prefix) =>
        {
            if (string.IsNullOrEmpty(srcPath) || !File.Exists(srcPath)) return;
            string want = Sha256(srcPath);
            string dir = Path.Combine(dest, "main_firmware");
            bool found = Directory.Exists(dir) && Directory.GetFiles(dir, prefix + "*.bin")
                                                          .Any(f => Sha256(f) == want);
            if (!found) differs.Add(prefix.TrimEnd('_') + " in the folder is NOT the file selected above");
        };
        cmp(txtCtrl.Text, "controller_");
        if (chkSystem.Checked) cmp(txtSys.Text, "system_");
        if (chkEsp.Checked && Directory.Exists(txtEsp.Text ?? ""))
        {
            string a = Path.Combine(txtEsp.Text, "firmware.bin");
            string b = Path.Combine(dest, @"cloud_firmware\firmware.bin");
            if (File.Exists(a) && File.Exists(b) && Sha256(a) != Sha256(b))
                differs.Add("cloud module firmware.bin in the folder is NOT the file selected above");
        }

        foreach (string b in bad) Log("   !! " + b);
        foreach (string d2 in differs) Log("   !! " + d2);

        if (bad.Count == 0 && differs.Count == 0)
        {
            Log("=== VERIFIED: " + checkedCount + " file(s), all exactly as delivered and identical to the files selected above. ===");
            Status("Folder verified - it contains exactly the firmware selected.");
            MessageBox.Show("VERIFIED\n\n" + checkedCount + " firmware file(s) checked.\n\n" +
                            "The folder contains exactly the firmware selected in this window,\n" +
                            "unchanged since it was prepared.", "Folder is correct",
                            MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        else
        {
            Status("Folder check FAILED - see the log.");
            MessageBox.Show("PROBLEM - do not send this folder:\n\n" +
                            string.Join("\n", bad.Concat(differs).ToArray()),
                            "Folder is NOT correct", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    static string Sha256(string path)
    {
        using (var sha = System.Security.Cryptography.SHA256.Create())
        using (var fs = File.OpenRead(path))
            return BitConverter.ToString(sha.ComputeHash(fs)).Replace("-", "").ToLowerInvariant();
    }

    /* The only tools\ scripts a customer's launcher calls. Everything else in
     * tools\ is YOURS (keys, publishing, this program's source). */
    static readonly string[] CustomerTools = {
        "serve.ps1", "check_auto_connect.ps1", "enable_auto_connect.ps1",
        "install_dfu_driver.ps1", "INSTALL_DFU_DRIVER.bat"
    };

    /* Folders that must never reach a customer: your keys and scripts, the
     * firmware server repo, the Android signing keystore, tests, screenshots,
     * the old per-customer app copies, packaging output, tooling caches. */
    static readonly string[] SkipDirs = {
        ".git", "firmware", "tools", "android", "tests", "c", "dist", "docs",
        ".playwright-mcp", "node_modules", ".vscode"
    };

    /* Internal notes and your own release tool - not part of the product. */
    static readonly string[] SkipFiles = {
        "gata.license",                     // replaced with THEIR license
        "gata-updater.apk",                 // the phone app is a separate delivery, not part of this folder
        ".nojekyll",                        // a GitHub Pages marker - meaningless off the web host
        "GATA_Release_Manager.exe",         // your tool, never ship it
        "HOW_TO_RELEASE.html", "OPERATIONS.md", "README.md",
        "changes_from_rev5_to_rev6.json",
        ".gitignore", ".gitattributes"
    };

    /* Remove js\mock.js from a built folder, and every reference to it. */
    static void StripDemoSimulator(string dest, Action<string> log)
    {
        try
        {
            string mock = Path.Combine(dest, "js\\mock.js");
            if (File.Exists(mock)) File.Delete(mock);

            string idx = Path.Combine(dest, "index.html");
            if (File.Exists(idx))
            {
                var kept = File.ReadAllLines(idx).Where(l => !l.Contains("js/mock.js")).ToArray();
                File.WriteAllLines(idx, kept, new UTF8Encoding(false));
            }

            /* The service worker lists it in SHELL, and addAll() is all-or-
             * nothing: leaving the name behind would make the offline cache
             * fail every time. */
            string sw = Path.Combine(dest, "sw.js");
            if (File.Exists(sw))
            {
                string t = File.ReadAllText(sw);
                t = t.Replace("\"js/mock.js\", ", "").Replace(", \"js/mock.js\"", "")
                     .Replace("\"js/mock.js\",", "").Replace("\"js/mock.js\"", "");
                File.WriteAllText(sw, t, new UTF8Encoding(false));
            }
            log("   demo simulator removed (js\\mock.js) - not needed to update a controller.");
        }
        catch (Exception ex) { log("   ! could not remove the demo simulator: " + ex.Message); }
    }

    void CopyTree(string src, string dst)
    {
        Directory.CreateDirectory(dst);
        foreach (string f in Directory.GetFiles(src))
        {
            string name = Path.GetFileName(f);
            if (SkipFiles.Any(s => s.Equals(name, StringComparison.OrdinalIgnoreCase))) continue;
            if (name.EndsWith(".cs", StringComparison.OrdinalIgnoreCase)) continue;      // sources
            if (name.EndsWith(".zip", StringComparison.OrdinalIgnoreCase)) continue;     // packaging
            File.Copy(f, Path.Combine(dst, name), true);
        }
        foreach (string d in Directory.GetDirectories(src))
        {
            string name = Path.GetFileName(d);
            if (SkipDirs.Any(s => s.Equals(name, StringComparison.OrdinalIgnoreCase))) continue;
            CopyTree(d, Path.Combine(dst, name));
        }
    }

    // ------------------------------------------------------------ new company
    void NewCompany()
    {
        string name = Prompt("New company", "Company name (as it should appear in their app):", "");
        if (string.IsNullOrEmpty(name)) return;
        string id = new string(name.ToLowerInvariant().Where(char.IsLetterOrDigit).ToArray());
        id = Prompt("New company", "Short channel id (letters/numbers, no spaces):", id);
        if (string.IsNullOrEmpty(id)) return;

        Busy(true);
        new Thread(() =>
        {
            try
            {
                Status("Creating the channel...");
                int rc = RunPs("new_customer.ps1", "-Id " + id + " -Name " + Q(name));
                if (rc != 0) { Status("Channel creation failed - see the log."); Busy(false); return; }

                Status("Issuing the license...");
                rc = RunPs("make_license.ps1", "-Customer " + Q(name) + " -Channel " + id);
                if (rc != 0) { Status("License creation failed - see the log."); Busy(false); return; }

                /* new_customer.ps1 also drops a half-built copy of the app in
                 * c\<id>: no licence, no firmware, and whatever version of the
                 * files it copied. Published, that is a company app that
                 * cannot install anything. The real one is built by
                 * build_customer_site.ps1 (ANDROID APP / FIRMWARE INSIDE THE
                 * APP), so remove the stub rather than leave a broken page
                 * waiting to be pushed. */
                string stub = Path.Combine(AppDir, "c\\" + id);
                if (Directory.Exists(stub) && !File.Exists(Path.Combine(stub, "gata.license")))
                {
                    try
                    {
                        Directory.Delete(stub, true);
                        Log("   removed the placeholder page c\\" + id +
                            " - build the real one with ANDROID APP when their firmware is chosen.");
                    }
                    catch (Exception ex) { Log("   ! could not remove c\\" + id + ": " + ex.Message); }
                }

                Log("");
                Log("=== " + name + " is ready. Publish for them, then build their uploader folder. ===");
                Log("Their Android app: choose their firmware above, then press ANDROID APP.");
                Status(name + " created.");
                BeginInvoke((Action)(() => { LoadCustomers(); LoadCloudList(); }));
            }
            catch (Exception ex) { Log("ERROR: " + ex.Message); }
            finally { Busy(false); }
        }) { IsBackground = true }.Start();
    }

    /* Build THIS COMPANY'S Android app. Each company gets its own app: its own
     * package name, its own licence, its own cloud channel and its own
     * built-in firmware - because their firmware is not the same firmware.
     *
     * Two steps, in this order:
     *   1. c\<id>\  - the company's own copy of the web app, with its licence
     *      and its firmware inside it. THIS is what the app opens.
     *   2. the apk itself, which is a thin wrapper around that address.
     * General is the site root, so it needs no step 1.
     *
     * Step 1 must be PUBLISHED (git push) before the app is built: the Android
     * tooling reads the web manifest over the network. */
    void BuildApk()
    {
        string channel = SelectedChannel();
        string who = channel == "default" ? "General" : Pretty(channel);
        bool isGeneral = channel == "default";
        string siteNote = isGeneral
            ? "General uses the site root."
            : "It will first rebuild c\\" + channel + " (their licence + the firmware chosen above).";

        if (MessageBox.Show(
                "Build the Android app for " + who + "?\n\n" + siteNote + "\n\n" +
                "The app opens THAT company's page, so it carries their licence\n" +
                "and their cloud channel.\n\n" +
                (chkInApp.Checked
                    ? "Firmware inside it: YES (the tick in section 3) - the phone stores\n" +
                      "the chosen files and can install with no internet."
                    : "Firmware inside it: NO (the tick in section 3 is clear) - the phone\n" +
                      "downloads from the cloud every time and cannot install offline.") + "\n\n" +
                "The page is published for you first, and the build waits until it\n" +
                "is really live.\n\n" +
                "Takes a few minutes.",
                "Android app - " + who, MessageBoxButtons.OKCancel, MessageBoxIcon.Question) != DialogResult.OK) return;

        /* Asked here, on the UI thread, before any work starts. */
        /* Only worth asking which board when the app is going to carry a
         * controller binary at all. */
        string apkBoard = null;
        if (chkInApp.Checked)
        {
            apkBoard = AskBoard("An app");
            if (apkBoard == null) return;
        }

        Busy(true);
        new Thread(() =>
        {
            try
            {
                DateTime started = DateTime.Now.AddSeconds(-5);

                /* The SAME tick decides what this app carries. It used to be
                 * ignored here, so building an .apk always baked the firmware
                 * in even with the box cleared - the tick said one thing and
                 * the app did another.
                 *
                 * The page is built and published BEFORE the apk, and waited
                 * for: the Android tooling reads the web manifest over the
                 * network, so an unpublished page means the apk is wrapped
                 * around the PREVIOUS version of it. */
                Status("Building " + who + "'s page...");
                ApplyFirmwareInsideApp(channel, who, apkBoard,
                    isGeneral ? "https://gata2024.github.io/gata-updater/app.webmanifest"
                              : "https://gata2024.github.io/gata-updater/c/" + channel + "/app.webmanifest");

                if (!isGeneral && !File.Exists(Path.Combine(AppDir, "c\\" + channel + "\\builtin.json")))
                {
                    Status("The company page was not built - see the log.");
                    Ask("Could not build c\\" + channel + " - see the log.\n\n" +
                        "The apk was NOT built.", "Android app", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return;
                }

                Status("Building " + who + "'s Android app (this takes a few minutes)...");
                RunPs("build_android_app.ps1", isGeneral ? "" : "-Id " + channel + " -Name \"" + who + "\"");
                /* Judge by the FILE, not the exit code: the Android tools leave
                 * odd exit codes behind even on a clean build. A fresh apk on
                 * disk is the honest proof. */
                string apk = Path.Combine(AppDir, isGeneral
                    ? @"dist\gata-updater.apk" : @"dist\gata-updater-" + channel + ".apk");
                if (File.Exists(apk) && File.GetLastWriteTime(apk) >= started)
                {
                    var fi = new FileInfo(apk);
                    Log("");
                    Log("=== APK READY: " + apk + "  (" + string.Format("{0:N0}", fi.Length) + " bytes) ===");
                    Log("Send it to the phone and open it (Android asks to allow installing from this source).");
                    Status("Android app ready.");
                    if (Ask("Android app built:\n\n" + apk + "\n\nOpen the folder?",
                                        "Done", MessageBoxButtons.YesNo, MessageBoxIcon.Information) == DialogResult.Yes)
                        Process.Start("explorer.exe", "/select,\"" + apk + "\"");
                }
                else
                {
                    Status("APK build failed - see the log.");
                    Ask("The Android build did not finish - see the log.\n\n" +
                                    "It needs Android Studio (JDK), the Android SDK and Node/npx on this PC.",
                                    "Android app", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
            }
            catch (Exception ex) { Log("ERROR: " + ex.Message); Status("Failed - see the log."); }
            finally { Busy(false); }
        }) { IsBackground = true }.Start();
    }

    /* The firmware inside a company's app, driven by the tick in section 3.
     *
     * Ticked  : the same files go into their app and it is published, so the
     *           phone stores them and installs with no internet.
     * Unticked: the app is left carrying NOTHING - whatever was inside is
     *           removed - so every install downloads from the cloud.
     *
     * Either way the app is published, because writing it here changes
     * nothing for a phone until it is.
     *
     * General is the site root (there is no c\default), so it has its own
     * script; every other company is a page under c\. */
    void ApplyFirmwareInsideApp(string channel, string who, string board, string waitUrl)
    {
        bool include = chkInApp.Checked;
        Log("");
        Log(include
            ? "=== firmware inside " + who + "'s app (" + board + ") ==="
            : "=== " + who + "'s app: removing the firmware inside it ===");

        string a;
        if (channel == "default")
        {
            a = "-Company \"" + who + "\"";
            if (include)
            {
                a += " -Board " + board +
                     " -Controller \"" + txtCtrl.Text + "\"" +
                     (File.Exists(txtSys.Text) ? " -System \"" + txtSys.Text + "\"" : "") +
                     (chkEsp.Checked && Directory.Exists(txtEsp.Text)
                          ? " -EspDir \"" + txtEsp.Text + "\"" : " -NoEsp");
            }
            else a += " -NoFirmware";
            RunPs("refresh_builtin.ps1", a);
        }
        else
        {
            a = "-Id " + channel + " -Name \"" + who + "\" -Board " + (board ?? "rev5");
            if (include)
            {
                a += " -Controller \"" + txtCtrl.Text + "\"" +
                     (File.Exists(txtSys.Text) ? " -System \"" + txtSys.Text + "\"" : "") +
                     (chkEsp.Checked && Directory.Exists(txtEsp.Text)
                          ? " -EspDir \"" + txtEsp.Text + "\"" : " -NoEsp");
            }
            else a += " -NoFirmware";
            RunPs("build_customer_site.ps1", a);
        }

        Status("Publishing " + who + "'s app...");
        DeployApp(who + (include ? " app firmware" : " app: firmware removed"), waitUrl);
    }

    /* PUBLISH and BUILD FOLDER do every ticked board - one release, one folder
     * each. An APP cannot: it holds ONE controller binary, so exactly one
     * board has to be named. Both boxes are ticked by default, and resolving
     * that silently to rev5 meant a rev 6 controller was copied in under a
     * name saying rev5. Ask instead of guessing; null = the question was
     * dismissed. */
    string AskBoard(string what)
    {
        if (chkRev5.Checked && !chkRev6.Checked) return "rev5";
        if (chkRev6.Checked && !chkRev5.Checked) return "rev6";

        using (var f = new Form())
        {
            f.Text = "Which board?";
            f.FormBorderStyle = FormBorderStyle.FixedDialog;
            f.StartPosition = FormStartPosition.CenterParent;
            f.MinimizeBox = f.MaximizeBox = false;
            f.ClientSize = new Size(470, 132);
            f.Font = new Font("Segoe UI", 9F);
            f.Controls.Add(new Label
            {
                Left = 16, Top = 14, Width = 440, Height = 56,
                Text = what + " holds the controller software for ONE board.\n" +
                       "Both boards are ticked above - which one is this for?"
            });
            string picked = null;
            var b5 = new Button { Left = 16, Top = 80, Width = 200, Height = 34, Text = "Board rev 5" };
            var b6 = new Button { Left = 226, Top = 80, Width = 200, Height = 34, Text = "Board rev 6" };
            b5.Click += (s, e) => { picked = "rev5"; f.DialogResult = DialogResult.OK; };
            b6.Click += (s, e) => { picked = "rev6"; f.DialogResult = DialogResult.OK; };
            f.Controls.Add(b5);
            f.Controls.Add(b6);
            if (InvokeRequired) return (string)Invoke(new Func<string>(() =>
            { return f.ShowDialog(this) == DialogResult.OK ? picked : null; }));
            return f.ShowDialog(this) == DialogResult.OK ? picked : null;
        }
    }

    /* Publish the app itself. Firmware "inside an app" lives on the WEBSITE,
     * not in the .apk, so nothing reaches a phone until this runs - and doing
     * it by hand was a step that could be forgotten, which looks exactly like
     * "the app has no firmware". Every button that changes an app page calls
     * this, so the push is never a separate thing to remember.
     *
     * waitUrl (optional): poll until that address really serves, before
     * carrying on - needed before building an .apk, because the Android
     * tooling reads the web manifest over the network. */
    void DeployApp(string message, string waitUrl)
    {
        string a = "-Message \"" + (message ?? "app update").Replace("\"", "'") + "\"";
        if (!string.IsNullOrEmpty(waitUrl)) a += " -WaitForUrl \"" + waitUrl + "\"";
        int rc = RunPs("deploy_app.ps1", a);
        if (rc != 0)
            Log("   !! the app could NOT be published - phones keep the page they already have.");
    }

    void BackupKeys()
    {
        using (var d = new FolderBrowserDialog { Description = "Where should the key backup be saved? (USB stick recommended)" })
        {
            if (d.ShowDialog() != DialogResult.OK) return;
            string dest = Path.Combine(d.SelectedPath, "GATA_keys_backup_" + DateTime.Now.ToString("yyyy-MM-dd"));
            Directory.CreateDirectory(dest);
            int n = 0;
            foreach (string rel in new[] { @"tools\signing_key.json", @"tools\license_key.json",
                                           @"tools\driver_signing_key.pfx",
                                           @"tools\licenses_issued.txt", @"android\gata-release.keystore" })
            {
                string src = Path.Combine(AppDir, rel);
                if (File.Exists(src)) { File.Copy(src, Path.Combine(dest, Path.GetFileName(src)), true); n++; Log("   backed up: " + rel); }
            }
            string licDir = Path.Combine(ToolsDir, "licenses");
            if (Directory.Exists(licDir))
            {
                string t = Path.Combine(dest, "licenses");
                Directory.CreateDirectory(t);
                foreach (var f in Directory.GetFiles(licDir)) { File.Copy(f, Path.Combine(t, Path.GetFileName(f)), true); n++; }
            }
            Log("=== " + n + " file(s) backed up to " + dest + " ===");
            MessageBox.Show(n + " file(s) copied to:\n\n" + dest + "\n\nKeep this somewhere safe and offline.",
                            "Backup done", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
    }

    void OpenGuide()
    {
        string g = Path.Combine(AppDir, "HOW_TO_RELEASE.html");
        if (File.Exists(g)) Process.Start(new ProcessStartInfo(g) { UseShellExecute = true });
        else MessageBox.Show("HOW_TO_RELEASE.html not found next to this program.", "Guide");
    }

    // simple input box (no VB reference needed)
    static string Prompt(string title, string label, string preset)
    {
        using (var f = new Form { Text = title, Size = new Size(460, 170), StartPosition = FormStartPosition.CenterParent,
                                  FormBorderStyle = FormBorderStyle.FixedDialog, MaximizeBox = false, MinimizeBox = false })
        {
            var l = new Label { Left = 16, Top = 16, Width = 410, Height = 32, Text = label };
            var t = new TextBox { Left = 16, Top = 52, Width = 410, Text = preset };
            var ok = new Button { Text = "OK", Left = 250, Top = 88, Width = 84, DialogResult = DialogResult.OK };
            var no = new Button { Text = "Cancel", Left = 342, Top = 88, Width = 84, DialogResult = DialogResult.Cancel };
            f.Controls.AddRange(new Control[] { l, t, ok, no });
            f.AcceptButton = ok; f.CancelButton = no;
            return f.ShowDialog() == DialogResult.OK ? t.Text.Trim() : null;
        }
    }
}
