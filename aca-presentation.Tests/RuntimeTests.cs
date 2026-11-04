using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;

namespace Sharing.Presentation.Tests;

public sealed class RuntimeTests
{
    private static WebApplicationFactory<Program> CreateApp(Dictionary<string, string?>? values = null)
    {
        var settings = new Dictionary<string, string?>
        {
            ["APP_VERSION"] = "v1",
            ["CONTAINER_APP_NAME"] = null,
            ["CONTAINER_APP_REVISION"] = null,
            ["CONTAINER_APP_REPLICA_NAME"] = null
        };
        foreach (var pair in values ?? [])
        {
            settings[pair.Key] = pair.Value;
        }
        return new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, configuration) =>
                configuration.AddInMemoryCollection(settings));
        });
    }

    [Fact]
    public async Task RuntimeExposesRealMetadataWithFreshRequestIdentity()
    {
        await using var factory = CreateApp(new()
        {
            ["APP_VERSION"] = "v2",
            ["CONTAINER_APP_NAME"] = "sharing",
            ["CONTAINER_APP_REVISION"] = "sharing--second",
            ["CONTAINER_APP_REPLICA_NAME"] = "sharing--second-replica",
            ["PRIVATE_SECRET"] = "must-not-be-returned"
        });
        using var client = factory.CreateClient();
        var before = DateTimeOffset.UtcNow;
        using var response = await client.GetAsync("/api/info");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("v2", body.GetProperty("version").GetString());
        Assert.Equal("azure-container-apps", body.GetProperty("environment").GetString());
        Assert.Equal("sharing", body.GetProperty("appName").GetString());
        Assert.Equal("sharing--second", body.GetProperty("revision").GetString());
        Assert.Equal("sharing--second-replica", body.GetProperty("replica").GetString());
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
        var requestId = body.GetProperty("requestId").GetString();
        Assert.True(Guid.TryParse(requestId, out _));
        Assert.Equal(requestId, response.Headers.GetValues("X-Request-Id").Single());
        Assert.InRange(body.GetProperty("serverTime").GetDateTimeOffset(), before, DateTimeOffset.UtcNow);
        Assert.True(body.GetProperty("uptimeSeconds").GetInt64() >= 0);
        Assert.DoesNotContain("must-not-be-returned", body.ToString());
        var next = await client.GetFromJsonAsync<JsonElement>("/api/info");
        Assert.NotEqual(requestId, next.GetProperty("requestId").GetString());
    }

    [Fact]
    public async Task LocalModeDoesNotInventAzureMetadata()
    {
        await using var factory = CreateApp();
        using var client = factory.CreateClient();
        var body = await client.GetFromJsonAsync<JsonElement>("/api/info");
        Assert.Equal("local", body.GetProperty("environment").GetString());
        Assert.Equal("v1", body.GetProperty("version").GetString());
        Assert.Equal(JsonValueKind.Null, body.GetProperty("revision").ValueKind);
        Assert.Equal(JsonValueKind.Null, body.GetProperty("replica").ValueKind);
        Assert.Equal(Dns.GetHostName(), body.GetProperty("hostname").GetString());
    }

    [Fact]
    public async Task HealthChecksSupportGetAndHead()
    {
        await using var factory = CreateApp();
        using var client = factory.CreateClient();
        var body = await client.GetFromJsonAsync<JsonElement>("/healthz");
        Assert.Equal("ok", body.GetProperty("status").GetString());
        using var request = new HttpRequestMessage(HttpMethod.Head, "/healthz");
        using var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("", await response.Content.ReadAsStringAsync());
    }

    [Theory]
    [InlineData("/Program.cs")]
    [InlineData("/.env")]
    [InlineData("/appsettings.json")]
    [InlineData("/missing")]
    public async Task NonPublicFilesAreNotServed(string path)
    {
        await using var factory = CreateApp();
        using var client = factory.CreateClient();
        using var response = await client.GetAsync(path);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task ApiRejectsWrites()
    {
        await using var factory = CreateApp();
        using var client = factory.CreateClient();
        using var response = await client.PostAsJsonAsync("/api/info", new { version = "v99" });
        Assert.Equal(HttpStatusCode.MethodNotAllowed, response.StatusCode);
    }
}
