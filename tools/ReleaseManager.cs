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
                board, s => Console.WriteLine(s));
            foreach (string p in probs) Console.WriteLine("PROBLEM: " + p);
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

        string parent;
        using (var d = new FolderBrowserDialog
        {
            Description = "Where should the " + who + " uploader folder" + (boards.Count > 1 ? "s" : "") + " be created?",
            SelectedPath = @"D:\"
        })
        {
            if (d.ShowDialog() != DialogResult.OK) return;
            parent = d.SelectedPath;
        }

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
                    var problems = BuildFolderCore(channel, dest, board, Log);
                    if (problems.Count > 0) allProblems.AddRange(problems);
                    else made.Add(dest);
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
    public List<string> BuildFolderCore(string channel, string dest, string board, Action<string> log)
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

        int n = CopyLatestFirmware(channel, dest, board, log);
        log("   offline firmware files copied: " + n);

        /* A channel that never received the newest release would silently ship
         * months-old firmware. Say so plainly instead. */
        string manPath = channel == "default"
            ? Path.Combine(FirmwareDir, "manifest.json")
            : Path.Combine(FirmwareDir, "customers", channel, "manifest.json");
        if (n == 0)
            problems.Add("NO FIRMWARE for " + board + " on the '" + channel + "' channel - publish for " +
                         who + " first (tick " + board + " and press PUBLISH TO CLOUD), then build this folder again.");
        else if (channel != "default" && File.Exists(manPath))
        {
            /* Compare RELEASE DATES, not names: per-channel names always differ
             * (they carry the company), so comparing names warned even when the
             * channel was ahead. Dates are ISO, so a plain string compare works.
             * Only a channel that is genuinely BEHIND General is worth a word. */
            string mineDate = NewestVersionDate(File.ReadAllText(manPath));
            string genPath = Path.Combine(FirmwareDir, "manifest.json");
            string genDate = File.Exists(genPath) ? NewestVersionDate(File.ReadAllText(genPath)) : null;
            if (mineDate != null && genDate != null &&
                string.Compare(mineDate, genDate, StringComparison.Ordinal) < 0)
                log("   NOTE: " + who + "'s newest release is from " + mineDate + ", General is on " + genDate +
                    ". Publish for " + who + " if they should get the newer software.");
        }

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

    /* Copy the newest published firmware FOR THE CHOSEN BOARD of a channel
     * into the customer folder's offline directories.
     *
     * The board matters: a release published before rev 6 existed carries no
     * board field and runs ONLY on rev 5, so handing it to a rev 6 customer
     * would be wrong. Same rule the app itself uses: take a version when its
     * board is "all" (unified binary) or equals the wanted one; a missing
     * board field means rev 5. */
    int CopyLatestFirmware(string channel, string dest, string board, Action<string> log)
    {
        string manPath = channel == "default"
            ? Path.Combine(FirmwareDir, "manifest.json")
            : Path.Combine(FirmwareDir, "customers", channel, "manifest.json");
        if (!File.Exists(manPath)) { log("   ! no manifest for this channel yet"); return 0; }

        string json = File.ReadAllText(manPath);
        string first = VersionBlockForBoard(json, board);
        if (first == null)
        {
            log("   !! this channel has NO firmware published for " + board + ".");
            return 0;
        }
        string usedVer = ValueOf(first, "version"), usedDate = ValueOf(first, "date");
        log("   using published version: " + usedVer + "   (" + usedDate + ", " + board + ")");

        // The urls we need are plain strings - pull them out without a JSON lib.
        var urls = new List<string>();
        int idx = 0;
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
            log("      " + name);
            n++;
        }
        return n;
    }

    /* Walk the version list (newest first) and return the first block that
     * fits the wanted board, or null when the channel has none. */
    static string VersionBlockForBoard(string json, string board)
    {
        int v = json.IndexOf("\"versions\"");
        if (v < 0) return null;
        int i = json.IndexOf('[', v);
        if (i < 0) return null;

        while (true)
        {
            int start = json.IndexOf('{', i);
            if (start < 0) return null;
            int depth = 0, end = -1;
            for (int k = start; k < json.Length; k++)
            {
                if (json[k] == '{') depth++;
                else if (json[k] == '}') { depth--; if (depth == 0) { end = k; break; } }
            }
            if (end < 0) return null;
            string block = json.Substring(start, end - start + 1);

            string b = ValueOf(block, "board");
            if (string.IsNullOrEmpty(b)) b = "rev5";      // published before rev 6 existed
            if (b == "all" || b == board) return block;

            i = end + 1;
            if (json.IndexOf('{', i) < 0) return null;
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
        int q2 = block.IndexOf('"', q1 + 1);
        if (q2 < 0) return null;
        return block.Substring(q1 + 1, q2 - q1 - 1);
    }

    /* Release date of a channel's newest entry - used to point out a channel
     * that is behind (e.g. Danway still on an older build). */
    static string NewestVersionDate(string json)
    {
        int v = json.IndexOf("\"versions\"");
        if (v < 0) return null;
        int start = json.IndexOf('{', v);
        if (start < 0) return null;
        int depth = 0;
        for (int k = start; k < json.Length; k++)
        {
            if (json[k] == '{') depth++;
            else if (json[k] == '}') { depth--; if (depth == 0) return ValueOf(json.Substring(start, k - start + 1), "date"); }
        }
        return null;
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
