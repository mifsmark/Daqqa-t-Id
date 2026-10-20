using System.Collections.Concurrent;
using Azure.Identity;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;

public static class MediaStorage
{
    private static readonly ConcurrentDictionary<string, BlobContainerClient> BlobContainers = new(StringComparer.OrdinalIgnoreCase);

    public static async Task WriteAsync(IConfiguration configuration, IWebHostEnvironment environment, string key,
        string contentType, byte[] bytes, CancellationToken ct)
    {
        if (GetBlobContainer(configuration) is { } container)
        {
            var blob = container.GetBlobClient(key);
            await blob.UploadAsync(new BinaryData(bytes), new BlobUploadOptions
            {
                HttpHeaders = new BlobHttpHeaders { ContentType = contentType }
            }, ct);
            return;
        }

        var path = GetLocalPath(configuration, environment, key);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        await using var file = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None,
            bufferSize: 81920, FileOptions.Asynchronous | FileOptions.SequentialScan);
        await file.WriteAsync(bytes, ct);
    }

    public static async Task<Stream?> OpenReadAsync(IConfiguration configuration, IWebHostEnvironment environment,
        string key, CancellationToken ct)
    {
        if (GetBlobContainer(configuration) is { } container)
        {
            try
            {
                var download = await container.GetBlobClient(key).DownloadStreamingAsync(cancellationToken: ct);
                return download.Value.Content;
            }
            catch (Azure.RequestFailedException exception) when (exception.Status == 404)
            {
                return null;
            }
        }

        var path = GetLocalPath(configuration, environment, key);
        if (!File.Exists(path)) return null;
        return new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read,
            bufferSize: 81920, FileOptions.Asynchronous | FileOptions.SequentialScan);
    }

    public static async Task DeleteAsync(IConfiguration configuration, IWebHostEnvironment environment,
        string key, CancellationToken ct)
    {
        if (GetBlobContainer(configuration) is { } container)
        {
            await container.GetBlobClient(key).DeleteIfExistsAsync(cancellationToken: ct);
            return;
        }

        var path = GetLocalPath(configuration, environment, key);
        if (File.Exists(path)) File.Delete(path);
    }

    public static bool UsesBlobStorage(IConfiguration configuration) => GetBlobServiceUri(configuration) is not null;

    private static BlobContainerClient? GetBlobContainer(IConfiguration configuration)
    {
        var serviceUri = GetBlobServiceUri(configuration);
        if (serviceUri is null) return null;
        var containerName = configuration["Media:ContainerName"]?.Trim();
        if (string.IsNullOrWhiteSpace(containerName)) containerName = "uploads";
        var cacheKey = $"{serviceUri.AbsoluteUri}|{containerName}";
        return BlobContainers.GetOrAdd(cacheKey, _ => new BlobServiceClient(serviceUri, new DefaultAzureCredential())
            .GetBlobContainerClient(containerName));
    }

    private static Uri? GetBlobServiceUri(IConfiguration configuration)
    {
        var value = configuration["Media:BlobServiceUri"]?.Trim();
        if (string.IsNullOrEmpty(value)) return null;
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps)
            throw new InvalidOperationException("Media:BlobServiceUri must be an absolute HTTPS URI.");
        return uri;
    }

    private static string GetLocalPath(IConfiguration configuration, IWebHostEnvironment environment, string key)
    {
        if (string.IsNullOrWhiteSpace(key) || Path.GetFileName(key) != key || key.Contains('/') || key.Contains('\\'))
            throw new InvalidOperationException("Media storage keys must be file names.");
        var configured = configuration["Media:StoragePath"] ?? "App_Data/uploads";
        var fullPath = Path.GetFullPath(Path.IsPathRooted(configured) ? configured : Path.Combine(environment.ContentRootPath, configured));
        var webRoot = Path.GetFullPath(environment.WebRootPath ?? Path.Combine(environment.ContentRootPath, "wwwroot"));
        if (fullPath.Equals(webRoot, StringComparison.OrdinalIgnoreCase) || fullPath.StartsWith(webRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Media storage must be outside the web root.");
        return Path.Combine(fullPath, key);
    }
}
