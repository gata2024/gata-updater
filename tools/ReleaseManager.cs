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
    TextBox txtCtrl, txtSys, txtEsp, txtNotes, txtLog;
    Button btnPublish, btnBuildFolder, btnNewCompany, btnBackup, btnOpenGuide, btnRefresh;
    Label lblStatus;
    ProgressBar bar;

    [STAThread]
    static void Main()
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
        Application.Run(new ReleaseManager());
    }

    public ReleaseManager()
    {
        Text = "GATA Release Manager";
        Size = new Size(940, 760);
        MinimumSize = new Size(840, 640);
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
        y += 30;

        chkSystem = new CheckBox { Left = 24, Top = y + 2, Width = 154, Text = "System firmware", Checked = true };
        Controls.Add(chkSystem);
        txtSys = new TextBox { Left = 178, Top = y, Width = 620 };
        Controls.Add(txtSys);
        Mk("...", 804, y - 1, 40, (s, e) => Browse(txtSys, "System firmware|*.bin"));
        chkSystem.CheckedChanged += (s, e) => txtSys.Enabled = chkSystem.Checked;
        y += 30;

        chkEsp = new CheckBox { Left = 24, Top = y + 2, Width = 154, Text = "Cloud module (ESP32)", Checked = true };
        Controls.Add(chkEsp);
        txtEsp = new TextBox { Left = 178, Top = y, Width = 620 };
        Controls.Add(txtEsp);
        Mk("...", 804, y - 1, 40, (s, e) => BrowseFolder(txtEsp));
        chkEsp.CheckedChanged += (s, e) => txtEsp.Enabled = chkEsp.Checked;
        y += 34;

        Controls.Add(new Label { Left = 24, Top = y + 3, Width = 150, Text = "What changed (notes)" });
        txtNotes = new TextBox { Left = 178, Top = y, Width = 666 };
        Controls.Add(txtNotes);
        y += 38;

        // ---------------- 4. actions ----------------
        y = Section("4.  Go", y);
        btnPublish = Mk("PUBLISH TO CLOUD", 24, y, 210, (s, e) => Publish());
        btnPublish.BackColor = Color.FromArgb(38, 110, 210);
        btnPublish.ForeColor = Color.White;
        btnPublish.Font = new Font("Segoe UI", 9.5F, FontStyle.Bold);
        btnPublish.Height = 34;

        btnBuildFolder = Mk("BUILD CUSTOMER UPLOADER FOLDER", 244, y, 270, (s, e) => BuildFolder());
        btnBuildFolder.Height = 34;

        btnBackup = Mk("Back up keys", 524, y, 120, (s, e) => BackupKeys());
        btnBackup.Height = 34;
        btnOpenGuide = Mk("Open guide", 654, y, 110, (s, e) => OpenGuide());
        btnOpenGuide.Height = 34;
        y += 44;

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

    Button Mk(string text, int x, int y, int w, EventHandler onClick)
    {
        var b = new Button { Left = x, Top = y, Width = w, Height = 26, Text = text, UseVisualStyleBackColor = true };
        b.Click += onClick;
        Controls.Add(b);
        return b;
    }

    void Browse(TextBox target, string filter)
    {
        using (var d = new OpenFileDialog { Filter = filter + "|All files|*.*" })
        {
            try { if (target.Text.Length > 0) d.InitialDirectory = Path.GetDirectoryName(target.Text); } catch { }
            if (d.ShowDialog() == DialogResult.OK) target.Text = d.FileName;
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
                    if (chkEsp.Checked) a.Append(" -EspDir ").Append(Q(txtEsp.Text));
                    if (txtNotes.Text.Trim().Length > 0) a.Append(" -Notes ").Append(Q(txtNotes.Text.Trim().Replace("\"", "'")));

                    int rc = RunPs("publish_firmware.ps1", a.ToString());
                    if (rc != 0) { Status("FAILED for " + board + " - see the log."); Busy(false); return; }
                }
                Status("Published. Customers see it on their next start.");
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

        string dest;
        using (var d = new FolderBrowserDialog
        {
            Description = "Where should the " + who + " uploader folder be created?",
            SelectedPath = @"D:\"
        })
        {
            if (d.ShowDialog() != DialogResult.OK) return;
            dest = Path.Combine(d.SelectedPath, "Uploader_" + who.Replace(" ", "_"));
        }

        Busy(true);
        new Thread(() =>
        {
            try
            {
                Status("Copying the app...");
                Log("");
                Log("=== Building " + dest + " ===");

                // Copy the app WITHOUT keys, the firmware repo, tests and build junk.
                string[] skipDirs = { ".git", "firmware", "tools", "android", "tests", "c", "dist", ".playwright-mcp", "node_modules" };
                CopyTree(AppDir, dest, skipDirs);
                Log("   app files copied.");

                // their license
                File.Copy(licFile, Path.Combine(dest, "gata.license"), true);
                Log("   license: " + Path.GetFileName(licFile) + "  ->  gata.license");

                // their offline firmware, taken from what was last published on their channel
                Status("Adding the offline firmware files...");
                int n = CopyLatestFirmware(channel, dest);
                Log("   offline firmware files copied: " + n);

                Status("Done - folder ready to send.");
                Log("=== DONE ===");
                Log("Send the whole folder to " + who + ". They run CLICK_ME_START_ON_PC.bat.");
                if (n == 0)
                    Log("NOTE: no published firmware found for this channel - the folder has no offline .bin files yet " +
                        "(the customer will still get cloud updates). Publish first, then build the folder again.");

                if (MessageBox.Show("Folder ready:\n\n" + dest + "\n\nOpen it now?", "Done",
                                    MessageBoxButtons.YesNo, MessageBoxIcon.Information) == DialogResult.Yes)
                    Process.Start("explorer.exe", "\"" + dest + "\"");
            }
            catch (Exception ex) { Log("ERROR: " + ex.Message); Status("Failed - see the log."); }
            finally { Busy(false); }
        }) { IsBackground = true }.Start();
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

    /* Copy the newest published controller/system/esp files of a channel into
     * the customer folder's offline directories. Reads the channel manifest so
     * exactly the files of the LATEST version are taken. */
    int CopyLatestFirmware(string channel, string dest)
    {
        string manPath = channel == "default"
            ? Path.Combine(FirmwareDir, "manifest.json")
            : Path.Combine(FirmwareDir, "customers", channel, "manifest.json");
        if (!File.Exists(manPath)) return 0;

        string json = File.ReadAllText(manPath);
        // The urls we need are plain strings - pull them out without a JSON lib.
        var urls = new List<string>();
        int idx = 0;
        string first = FirstVersionBlock(json);
        while (true)
        {
            int u = first.IndexOf("\"url\"", idx);
            if (u < 0) break;
            int q1 = first.IndexOf('"', first.IndexOf(':', u) + 1);
            int q2 = first.IndexOf('"', q1 + 1);
            if (q1 < 0 || q2 < 0) break;
            urls.Add(first.Substring(q1 + 1, q2 - q1 - 1));
            idx = q2;
        }

        string mainDir = Path.Combine(dest, "main_firmware");
        string cloudDir = Path.Combine(dest, "cloud_firmware");
        Directory.CreateDirectory(mainDir);
        Directory.CreateDirectory(cloudDir);
        foreach (var f in Directory.GetFiles(mainDir, "*.bin")) File.Delete(f);   // no stale mixes
        foreach (var f in Directory.GetFiles(cloudDir, "*.bin")) File.Delete(f);

        int n = 0;
        foreach (string rel in urls)
        {
            string clean = rel.Replace("../", "").Replace('/', '\\');
            string src = Path.Combine(FirmwareDir, clean);
            if (!File.Exists(src)) continue;
            string name = Path.GetFileName(src);
            if (name.EndsWith(".lic", StringComparison.OrdinalIgnoreCase)) continue;

            bool isEsp = clean.IndexOf("esp\\", StringComparison.OrdinalIgnoreCase) >= 0;
            string target = Path.Combine(isEsp ? cloudDir : mainDir, name);
            File.Copy(src, target, true);
            Log("      " + name);
            n++;
        }
        return n;
    }

    static string FirstVersionBlock(string json)
    {
        int v = json.IndexOf("\"versions\"");
        if (v < 0) return json;
        int start = json.IndexOf('{', v);
        if (start < 0) return json;
        int depth = 0;
        for (int i = start; i < json.Length; i++)
        {
            if (json[i] == '{') depth++;
            else if (json[i] == '}') { depth--; if (depth == 0) return json.Substring(start, i - start + 1); }
        }
        return json.Substring(start);
    }

    void CopyTree(string src, string dst, string[] skipDirs)
    {
        Directory.CreateDirectory(dst);
        foreach (string f in Directory.GetFiles(src))
        {
            string name = Path.GetFileName(f);
            if (name.Equals("gata.license", StringComparison.OrdinalIgnoreCase)) continue;  // replaced below
            if (name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) &&
                name.IndexOf("Release", StringComparison.OrdinalIgnoreCase) >= 0) continue; // not this tool
            File.Copy(f, Path.Combine(dst, name), true);
        }
        foreach (string d in Directory.GetDirectories(src))
        {
            string name = Path.GetFileName(d);
            if (skipDirs.Any(s => s.Equals(name, StringComparison.OrdinalIgnoreCase))) continue;
            CopyTree(d, Path.Combine(dst, name), skipDirs);
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
                BeginInvoke((Action)LoadCustomers);
            }
            catch (Exception ex) { Log("ERROR: " + ex.Message); }
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
