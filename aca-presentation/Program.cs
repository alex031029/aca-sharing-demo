using System.Diagnostics;
using System.Net;

var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();
var lifetime = Stopwatch.StartNew();

app.Use(async (context, next) =>
{
    context.TraceIdentifier = Guid.NewGuid().ToString();
    context.Response.Headers.CacheControl = "no-store";
    context.Response.Headers["X-Request-Id"] = context.TraceIdentifier;
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    context.Response.Headers["Referrer-Policy"] = "no-referrer";
    context.Response.Headers.ContentSecurityPolicy =
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; " +
        "connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
    await next(context);
});

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapMethods("/healthz", ["GET", "HEAD"], (HttpContext context) =>
    HttpMethods.IsHead(context.Request.Method)
        ? Results.Ok()
        : Results.Json(new { status = "ok" }));

app.MapGet("/api/info", (HttpContext context, IConfiguration configuration) =>
{
    var appName = configuration["CONTAINER_APP_NAME"];
    return Results.Json(new
    {
        version = string.IsNullOrWhiteSpace(configuration["APP_VERSION"]) ? "v1" : configuration["APP_VERSION"],
        environment = string.IsNullOrEmpty(appName) ? "local" : "azure-container-apps",
        appName,
        revision = configuration["CONTAINER_APP_REVISION"],
        replica = configuration["CONTAINER_APP_REPLICA_NAME"],
        hostname = Dns.GetHostName(),
        serverTime = DateTimeOffset.UtcNow,
        uptimeSeconds = (long)lifetime.Elapsed.TotalSeconds,
        requestId = context.TraceIdentifier
    });
});

app.Run();

public partial class Program { }
