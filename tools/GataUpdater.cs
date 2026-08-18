/* GATA Updater - Windows launcher (compiled to GATA_Updater.exe).
 *
 * Replaces CLICK_ME_START_ON_PC.bat + tools\serve.ps1 with one double-clickable
 * program: it serves the updater folder on http://127.0.0.1:<port> and opens the
 * browser. Browsers only allow USB access from https:// or localhost, which is
 * why a local server is needed at all.
 *
 * Deliberately built on TcpListener rather than HttpListener: HttpListener needs
 * an URL reservation (admin rights) on Windows, TcpListener does not - the tool
 * must run for a technician with an ordinary account.
 *
 * Build (no SDK, no installs - the compiler ships with Windows):
 *   tools\build_exe.ps1
 */
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

static class GataUpdater
{
    static string Root;
    static int Port = 8765;

    static readonly Dictionary<string, string> Mime = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
        { ".html", "text/html; charset=utf-8" }, { ".htm", "text/html; charset=utf-8" },
        { ".js", "text/javascript; charset=utf-8" }, { ".css", "text/css; charset=utf-8" },
        { ".json", "application/json; charset=utf-8" },
        { ".webmanifest", "application/manifest+json; charset=utf-8" },
        { ".svg", "image/svg+xml" }, { ".png", "image/png" }, { ".ico", "image/x-icon" },
        { ".bin", "application/octet-stream" }, { ".txt", "text/plain; charset=utf-8" },
        { ".md", "text/plain; charset=utf-8" },
    };

    static int Main(string[] args)
    {
        Root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
        for (int i = 0; i < args.Length - 1; i++)
            if (args[i].Equals("-port", StringComparison.OrdinalIgnoreCase)) int.TryParse(args[i + 1], out Port);

        if (!File.Exists(Path.Combine(Root, "index.html")))
        {
            Console.WriteLine("GATA_Updater.exe must sit in the updater folder (next to index.html).");
            Console.Write("Press ENTER to close");
            Console.ReadLine();
            return 1;
        }

        // First run on this PC: create the firmware-source config from the example.
        string cfg = Path.Combine(Root, @"tools\firmware_source.json");
        string example = Path.Combine(Root, @"tools\firmware_source.example.json");
        try { if (!File.Exists(cfg) && File.Exists(example)) File.Copy(example, cfg); } catch { }

        TcpListener listener;
        try
        {
            listener = new TcpListener(IPAddress.Loopback, Port);
            listener.Start();
        }
        catch (SocketException)
        {
            Console.WriteLine("The updater is already running - opening it in the browser.");
            OpenBrowser();
            Thread.Sleep(1500);
            return 0;
        }

        Console.WriteLine("==============================================================");
        Console.WriteLine("  GATA Updater is running");
        Console.WriteLine("  Open:  http://127.0.0.1:" + Port + "/");
        Console.WriteLine("  Keep this window open while updating. Close it when finished.");
        Console.WriteLine("==============================================================");
        OpenBrowser();

        while (true)
        {
            TcpClient client = listener.AcceptTcpClient();
            // One thread per connection: the browser opens several at once, and a
            // firmware download must never block the page from loading.
            ThreadPool.QueueUserWorkItem(delegate { Serve(client); });
        }
    }

    static void OpenBrowser()
    {
        try { Process.Start(new ProcessStartInfo("http://127.0.0.1:" + Port + "/") { UseShellExecute = true }); }
        catch { Console.WriteLine("Could not open the browser - type the address above into Chrome."); }
    }

    static void Serve(TcpClient client)
    {
        try
        {
            client.ReceiveTimeout = 15000;
            client.SendTimeout = 120000;
            using (NetworkStream net = client.GetStream())
            {
                string head = ReadHead(net);
                if (head == null) return;
                string[] parts = head.Split(new[] { "\r\n" }, StringSplitOptions.None)[0].Split(' ');
                if (parts.Length < 2) return;
                string method = parts[0];
                string rawPath = parts[1];
                string path = Uri.UnescapeDataString(rawPath.Split('?')[0]);
                if (path.EndsWith("/")) path += "index.html";

                if (method != "GET" && method != "HEAD") { Send(net, "405 Method Not Allowed", "text/plain", Encoding.UTF8.GetBytes("method not allowed"), method); return; }
                if (path.StartsWith("/__local_list")) { Send(net, "200 OK", Mime[".json"], Encoding.UTF8.GetBytes(LocalList()), method); return; }
                if (path.StartsWith("/__fw/")) { Proxy(net, path.Substring(6), method); return; }

                string full = Path.GetFullPath(Path.Combine(Root, path.TrimStart('/').Replace('/', '\\')));
                if (!full.StartsWith(Root, StringComparison.OrdinalIgnoreCase))
                { Send(net, "403 Forbidden", "text/plain", Encoding.UTF8.GetBytes("forbidden"), method); return; }
                if (!File.Exists(full))
                { Send(net, "404 Not Found", "text/plain", Encoding.UTF8.GetBytes("not found: " + path), method); return; }

                string ctype = "application/octet-stream";
                string ext = Path.GetExtension(full);
                if (Mime.ContainsKey(ext)) ctype = Mime[ext];
                Send(net, "200 OK", ctype, File.ReadAllBytes(full), method);
            }
        }
        catch { /* a browser aborting a request must never take the server down */ }
        finally { try { client.Close(); } catch { } }
    }

    static string ReadHead(NetworkStream net)
    {
        var buf = new byte[4096];
        var sb = new StringBuilder();
        while (sb.ToString().IndexOf("\r\n\r\n", StringComparison.Ordinal) < 0)
        {
            int n = net.Read(buf, 0, buf.Length);
            if (n <= 0) return null;
            sb.Append(Encoding.ASCII.GetString(buf, 0, n));
            if (sb.Length > 65536) break;
        }
        return sb.ToString();
    }

    static void Send(NetworkStream net, string status, string ctype, byte[] body, string method)
    {
        string head = "HTTP/1.1 " + status + "\r\nContent-Type: " + ctype +
                      "\r\nContent-Length: " + body.Length +
                      "\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n";
        byte[] hb = Encoding.ASCII.GetBytes(head);
        net.Write(hb, 0, hb.Length);
        if (method == "GET") net.Write(body, 0, body.Length);
        net.Flush();
    }

    /* Firmware discovery for "use the files in this folder" mode. */
    static string LocalList()
    {
        return "{\"main_firmware\":" + ListBins("main_firmware") +
               ",\"cloud_firmware\":" + ListBins("cloud_firmware") + "}";
    }

    static string ListBins(string sub)
    {
        var sb = new StringBuilder("[");
        string dir = Path.Combine(Root, sub);
        if (Directory.Exists(dir))
        {
            var files = new List<FileInfo>();
            foreach (string f in Directory.GetFiles(dir, "*.bin")) files.Add(new FileInfo(f));
            files.Sort(delegate (FileInfo a, FileInfo b) { return b.LastWriteTimeUtc.CompareTo(a.LastWriteTimeUtc); });
            for (int i = 0; i < files.Count; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append("{\"name\":\"").Append(files[i].Name.Replace("\"", "")).Append("\",\"size\":")
                  .Append(files[i].Length.ToString(CultureInfo.InvariantCulture)).Append('}');
            }
        }
        return sb.Append(']').ToString();
    }

    /* Fetch firmware on the page's behalf: no CORS setup is ever needed, and a
     * token (if the firmware server requires one) stays on this PC. */
    static void Proxy(NetworkStream net, string rel, string method)
    {
        if (rel.Contains("..") || rel.Length == 0)
        { Send(net, "400 Bad Request", "text/plain", Encoding.UTF8.GetBytes("bad firmware path"), method); return; }

        string cfgPath = Path.Combine(Root, @"tools\firmware_source.json");
        if (!File.Exists(cfgPath))
        { Send(net, "502 Bad Gateway", "text/plain", Encoding.UTF8.GetBytes("no firmware source configured"), method); return; }

        try
        {
            string cfg = File.ReadAllText(cfgPath);
            string baseUrl = Field(cfg, "baseUrl");
            string token = Field(cfg, "token");
            if (!baseUrl.EndsWith("/")) baseUrl += "/";

            ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072;   // TLS 1.2
            var req = (HttpWebRequest)WebRequest.Create(baseUrl + rel);
            req.Timeout = 60000;
            req.ReadWriteTimeout = 180000;
            req.UserAgent = "GATA-Updater";
            if (!string.IsNullOrEmpty(token)) req.Headers.Add("Authorization", "token " + token);

            using (var resp = (HttpWebResponse)req.GetResponse())
            using (var ms = new MemoryStream())
            {
                resp.GetResponseStream().CopyTo(ms);
                byte[] body = ms.ToArray();
                string ctype = "application/octet-stream";
                string ext = Path.GetExtension(rel);
                if (Mime.ContainsKey(ext)) ctype = Mime[ext];
                Console.WriteLine("  [firmware] " + rel + " -> " + body.Length.ToString("N0") + " bytes");
                Send(net, "200 OK", ctype, body, method);
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine("  [firmware] FAILED " + rel + ": " + ex.Message);
            Send(net, "502 Bad Gateway", "text/plain",
                 Encoding.UTF8.GetBytes("firmware server unreachable: " + ex.Message), method);
        }
    }

    static string Field(string json, string name)
    {
        Match m = Regex.Match(json, "\"" + name + "\"\\s*:\\s*\"([^\"]*)\"");
        return m.Success ? m.Groups[1].Value : "";
    }
}
