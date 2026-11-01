using DaqqaTid.Domain;

namespace DaqqaTid.Application;

public sealed record WorkerCandidate(Guid WorkerId, string Locality, double RadiusKm, bool AvailableNow, IReadOnlySet<Guid> CategoryIds, IReadOnlySet<BookingMode> Modes, decimal? Price);

public static class WorkerMatching
{
    public static double DistanceKm(double latitudeA, double longitudeA, double latitudeB, double longitudeB)
    {
        const double earthRadiusKm = 6371.0088; static double Rad(double d) => d * Math.PI / 180;
        var dLat = Rad(latitudeB - latitudeA); var dLon = Rad(longitudeB - longitudeA);
        var h = Math.Pow(Math.Sin(dLat / 2), 2) + Math.Cos(Rad(latitudeA)) * Math.Cos(Rad(latitudeB)) * Math.Pow(Math.Sin(dLon / 2), 2);
        return 2 * earthRadiusKm * Math.Asin(Math.Min(1, Math.Sqrt(h)));
    }
    public static IReadOnlyList<T> Match<T>(IEnumerable<T> workers, Guid categoryId, BookingMode mode, string requestedLocality,
        IReadOnlyDictionary<string, (double Latitude, double Longitude)> localities, Func<T, WorkerCandidate> project, bool availableNow = false, decimal? maxPrice = null)
    {
        if (!localities.TryGetValue(requestedLocality, out var origin)) return [];
        var source = workers.ToArray();
        return source.Select(project).Where(w => w.CategoryIds.Contains(categoryId) && w.Modes.Contains(mode) && (!availableNow || w.AvailableNow) && (!maxPrice.HasValue || (w.Price.HasValue && w.Price.Value <= maxPrice.Value)))
            .Where(w => localities.TryGetValue(w.Locality, out var point) && DistanceKm(origin.Latitude, origin.Longitude, point.Latitude, point.Longitude) <= Math.Max(0, w.RadiusKm))
            .OrderBy(w => DistanceKm(origin.Latitude, origin.Longitude, localities[w.Locality].Latitude, localities[w.Locality].Longitude)).Select(w => source.First(x => project(x).WorkerId == w.WorkerId)).ToArray();
    }
    public static bool IsAvailableAt(WorkerProfile worker, DateTimeOffset startUtc, DateTimeOffset endUtc)
    {
        var malta = TimeZoneInfo.FindSystemTimeZoneById("Europe/Malta"); var startLocal = TimeZoneInfo.ConvertTime(startUtc, malta); var endLocal = TimeZoneInfo.ConvertTime(endUtc, malta);
        var day = DateOnly.FromDateTime(startLocal.DateTime); var exception = worker.Exceptions.FirstOrDefault(x => x.Date == day);
        if (exception is { IsAvailable: false }) return false;
        if (DateOnly.FromDateTime(endLocal.DateTime) != day) return false;
        var from = TimeOnly.FromDateTime(startLocal.DateTime); var to = TimeOnly.FromDateTime(endLocal.DateTime);
        return worker.Availability.Any(w => w.DayOfWeek == startLocal.DayOfWeek && w.StartTime <= from && w.EndTime >= to);
    }
}
