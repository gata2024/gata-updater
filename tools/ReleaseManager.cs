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
using System.Threading;
using System.Windows.Forms;

class ReleaseManager : Form
{
    // ---- paths ------------------------------------------------------------
    static string AppDir;        // ...\GATA_Cloud_Uploader
    static string ToolsDir;      // ...\tools
    static string FirmwareDir;   // ...\firmware
    static string RepoRoot;      // ...\gc22SramToflash

    // ---- controls ---------------------------------------------------------
    ComboBox cboCustomer;
    CheckBox chkRev5, chkRev6, chkSystem, chkEsp;
    TextBox txtCtrl, txtSys, txtEsp, txtNotes, txtLog, txtDest;
    Button btnPublish, btnBuildFolder, btnNewCompany, btnBackup, btnOpenGuide, btnRefresh, btnCheck, btnRemove, btnRefreshCloud, btnApk;
    ListView lstCloud;
    string lastBuiltFolder;
    Label lblStatus, lblCtrlFp, lblSysFp, lblEspFp;
    ProgressBar bar;
    readonly ToolTip toolTip = new ToolTip();

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

        /* Headless folder build - same code as the button, for scripting and
         * for checking a folder without clicking:
         *     GATA_Release_Manager.exe /buildfolder <channel> <parent folder>  */
        if (args.Length >= 3 && args[0].Equals("/buildfolder", StringComparison.OrdinalIgnoreCase))
        {
            string board = args.Length >= 4 ? args[3] : "rev5";
            var f = new ReleaseManager();
            string who = args[1] == "default" ? "General" : Pretty(args[1]);
            var probs = f.BuildFolderCore(args[1],
                Path.Combine(args[2], "Uploader_" + who.Replace(" ", "_") + "_" + board),
                board,
                Path.Combine(RepoRoot, @"g_500\Debug\NPC20_mini.bin"),
                Path.Combine(RepoRoot, @"USBupdaterCode_relbuild\Debug\Booster_phase.bin"),
                Path.Combine(RepoRoot, @"esp\.pio\build\esp32dev"),
                s => Console.WriteLine(s));
            foreach (string p in probs) Console.WriteLine("PROBLEM: " + p);
            return;
        }

        Application.Run(new ReleaseManager());
    }

    public ReleaseManager()
    {
        Text = "GATA Release Manager";
        Size = new Size(940, 940);
        MinimumSize = new Size(840, 800);
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
        btnBackup = Mk("Back up keys", 24, y, 120, (s, e) => BackupKeys());
        btnOpenGuide = Mk("Guide", 154, y, 80, (s, e) => OpenGuide());
        y += 36;

        // ---------------- 5. what is in the cloud right now ----------------
        y = Section("5.  In the cloud for this company right now", y);
        lstCloud = new ListView
        {
            Left = 24, Top = y, Width = 700, Height = 150, View = View.Details,
            FullRowSelect = true, MultiSelect = false, HideSelection = false,
            Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right
        };
        lstCloud.Columns.Add("Version", 260);
        lstCloud.Columns.Add("Board", 60);
        lstCloud.Columns.Add("Date", 90);
        lstCloud.Columns.Add("", 40);           // "now" marker for the latest
        lstCloud.Columns.Add("Notes", 240);
        Controls.Add(lstCloud);

        /* Anchored to the RIGHT edge: with Top|Left they stayed put while the
         * list stretched on a wide window and swallowed them. */
        btnRemove = Mk(ClientSize.Width - 164, y, 140, "Remove selected", (s, e) => RemoveSelected());
        btnRemove.Height = 30;
        btnRemove.ForeColor = Color.FromArgb(170, 30, 30);
        btnRemove.Anchor = AnchorStyles.Top | AnchorStyles.Right;
        btnRefreshCloud = Mk(ClientSize.Width - 164, y + 36, 140, "Refresh", (s, e) => LoadCloudList());
        btnRefreshCloud.Anchor = AnchorStyles.Top | AnchorStyles.Right;
        lstCloud.Width = ClientSize.Width - 24 - 164 - 10;
        y += 160;

        bar = new ProgressBar { Left = 24, Top = y, Width = 820, Height = 6, Style = ProgressBarStyle.Marquee, Visible = false };
        Controls.Add(bar);
        y += 12;

        lblStatus = new Label { Left = 24, Top = y, Width = 820, Height = 18, ForeColor = Color.FromArgb(70, 90, 120) };
        Controls.Add(lblStatus);
        y += 22;

        txtLog = new TextBox
        {
            Left = 24, Top = y, Width = 866, Height = 250,
            Multiline = true, ScrollBars = ScrollBars.Vertical, ReadOnly = true,
            BackColor = Color.FromArgb(24, 30, 44), ForeColor = Color.FromArgb(210, 222, 240),
            Font = new Font("Consolas", 8.75F),
            Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Bottom
        };
        Controls.Add(txtLog);

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
                var it = new ListViewItem(new[] { ver, board, date, latest ? "NOW" : "", notes });
                if (latest) it.Font = new Font(lstCloud.Font, FontStyle.Bold);
                lstCloud.Items.Add(it);
            }
            if (lstCloud.Items.Count > 0) lstCloud.Items[0].Selected = true;
        }
        catch (Exception ex) { Log("Could not read the channel list: " + ex.Message); }
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
                    "download until you publish again. Their uploader folder still works offline.";
        if (MessageBox.Show(warn, "Remove version", MessageBoxButtons.OKCancel,
                            MessageBoxIcon.Warning) != DialogResult.OK) return;

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
            p.WaitForExit();
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
        if (MessageBox.Show("Publish for " + who + " (" + string.Join(" + ", boards) + ")?\n\n" +
                            "This uploads to the cloud and every " + who + " updater will see it.",
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
                Status("Published. Customers see it on their next start.");
                BeginInvoke((Action)LoadCloudList);
                Log("");
                Log("=== DONE. Published for " + who + ": " + string.Join(", ", boards) + " ===");
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
                    var problems = BuildFolderCore(channel, dest, board,
                        txtCtrl.Text,
                        chkSystem.Checked ? txtSys.Text : null,
                        chkEsp.Checked ? txtEsp.Text : null,
                        Log);
                    if (problems.Count > 0) allProblems.AddRange(problems);
                    else { made.Add(dest); lastBuiltFolder = dest; }
                }
                if (allProblems.Count > 0)
                {
                    Status("Problems found - see the log.");
                    MessageBox.Show("Not everything is ready to send:\n\n" +
                                    string.Join("\n\n", allProblems.ToArray()),
                                    "Check failed", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    if (made.Count == 0) return;
                }
                Status("Done - " + made.Count + " folder(s) ready to send.");
                if (made.Count > 0 &&
                    MessageBox.Show("Ready:\n\n" + string.Join("\n", made.ToArray()) + "\n\nOpen now?", "Done",
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
            bool isUploader = File.Exists(Path.Combine(dest, "index.html")) &&
                              File.Exists(Path.Combine(dest, "CLICK_ME_START_ON_PC.bat"));
            if (!empty && !isUploader)
            {
                problems.Add("The folder already exists and does not look like an uploader folder: " + dest);
                log("   !! refusing to overwrite " + dest);
                return problems;
            }
            if (!empty)
            {
                foreach (string d in Directory.GetDirectories(dest))
                    try { Directory.Delete(d, true); } catch (Exception ex) { log("   ! could not remove old " + Path.GetFileName(d) + ": " + ex.Message); }
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

        /* The offline files are simply the ones picked in the window. */
        int n = CopySelectedFirmware(dest, who, board, ctrlPath, sysPath, espDir, log);
        log("   firmware files put in the folder: " + n);
        if (n == 0)
            problems.Add("No firmware files were copied - check the file paths in the window.");

        /* Prove the folder works before it is handed over: every script the
         * launcher calls must be present, the license must be there, and none
         * of your secrets may have leaked in. */
        foreach (string need in new[] { "index.html", "CLICK_ME_START_ON_PC.bat", "gata.license",
                                        @"tools\serve.ps1", @"tools\check_auto_connect.ps1",
                                        @"tools\enable_auto_connect.ps1", @"js\app.js", @"js\license.js" })
            if (!File.Exists(Path.Combine(dest, need))) problems.Add("MISSING: " + need);
        foreach (string secret in new[] { @"tools\signing_key.json", @"tools\license_key.json",
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

        string json = File.ReadAllText(rec);
        var bad = new List<string>();
        int checkedCount = 0;
        foreach (string rawLine in json.Split('\n'))
        {
            string t = rawLine.Trim();
            if (!t.StartsWith("\"main_firmware/") && !t.StartsWith("\"cloud_firmware/")) continue;
            int q = t.IndexOf("\": \"");
            if (q < 0) continue;
            string rel = t.Substring(1, q - 1);
            string want = t.Substring(q + 4).TrimEnd(',', '"', ' ');
            string path = Path.Combine(dest, rel.Replace('/', '\\'));
            if (!File.Exists(path)) { bad.Add(rel + " - MISSING"); continue; }
            string got = Sha256(path);
            checkedCount++;
            if (!string.Equals(got, want, StringComparison.OrdinalIgnoreCase))
                bad.Add(rel + " - CHANGED (" + got.Substring(0, 12) + " instead of " + want.Substring(0, 12) + ")");
            else
                Log("   ok  " + rel + "   [" + got.Substring(0, 12) + "]");
        }

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
        "GATA_Release_Manager.exe",         // your tool, never ship it
        "HOW_TO_RELEASE.html", "OPERATIONS.md", "README.md",
        "changes_from_rev5_to_rev6.json",
        ".gitignore", ".gitattributes"
    };

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

                Log("");
                Log("=== " + name + " is ready. Publish for them, then build their uploader folder. ===");
                Status(name + " created.");
                BeginInvoke((Action)(() => { LoadCustomers(); LoadCloudList(); }));
            }
            catch (Exception ex) { Log("ERROR: " + ex.Message); }
            finally { Busy(false); }
        }) { IsBackground = true }.Start();
    }

    /* Build the installable Android app. ONE apk serves every company - the
     * customer opens their license file in it (Open license file...), exactly
     * like the PC version, so there is nothing per-customer to build.
     * The apk wraps the HOSTED site, so publish the app first if you changed
     * it; firmware updates need no new apk at all. */
    void BuildApk()
    {
        if (MessageBox.Show(
                "Build the Android app (.apk)?\n\n" +
                "One app for every company - each customer opens their own license\n" +
                "file inside it. It loads the published web app, so make sure the\n" +
                "app itself is up to date on GitHub.\n\n" +
                "Takes a few minutes the first time.",
                "Android app", MessageBoxButtons.OKCancel, MessageBoxIcon.Question) != DialogResult.OK) return;

        Busy(true);
        new Thread(() =>
        {
            try
            {
                Status("Building the Android app (this takes a few minutes)...");
                DateTime started = DateTime.Now.AddSeconds(-5);
                RunPs("build_android_app.ps1", "");
                /* Judge by the FILE, not the exit code: the Android tools leave
                 * odd exit codes behind even on a clean build. A fresh apk on
                 * disk is the honest proof. */
                string apk = Path.Combine(AppDir, @"dist\gata-updater.apk");
                if (File.Exists(apk) && File.GetLastWriteTime(apk) >= started)
                {
                    var fi = new FileInfo(apk);
                    Log("");
                    Log("=== APK READY: " + apk + "  (" + string.Format("{0:N0}", fi.Length) + " bytes) ===");
                    Log("Send it to the phone and open it (Android asks to allow installing from this source).");
                    Status("Android app ready.");
                    if (MessageBox.Show("Android app built:\n\n" + apk + "\n\nOpen the folder?",
                                        "Done", MessageBoxButtons.YesNo, MessageBoxIcon.Information) == DialogResult.Yes)
                        Process.Start("explorer.exe", "/select,\"" + apk + "\"");
                }
                else
                {
                    Status("APK build failed - see the log.");
                    MessageBox.Show("The Android build did not finish - see the log.\n\n" +
                                    "It needs Android Studio (JDK), the Android SDK and Node/npx on this PC.",
                                    "Android app", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
            }
            catch (Exception ex) { Log("ERROR: " + ex.Message); Status("Failed - see the log."); }
            finally { Busy(false); }
        }) { IsBackground = true }.Start();
    }

    // ---------------------------------------------------------------- backup
    void BackupKeys()
    {
        using (var d = new FolderBrowserDialog { Description = "Where should the key backup be saved? (USB stick recommended)" })
        {
            if (d.ShowDialog() != DialogResult.OK) return;
            string dest = Path.Combine(d.SelectedPath, "GATA_keys_backup_" + DateTime.Now.ToString("yyyy-MM-dd"));
            Directory.CreateDirectory(dest);
            int n = 0;
            foreach (string rel in new[] { @"tools\signing_key.json", @"tools\license_key.json",
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
