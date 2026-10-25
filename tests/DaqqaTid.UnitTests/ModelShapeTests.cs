using DaqqaTid.Domain;
using DaqqaTid.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Xunit;

namespace DaqqaTid.UnitTests;

public sealed class ModelShapeTests
{
    private static AppDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlServer("Server=localhost;Database=ModelOnly;Integrated Security=True;TrustServerCertificate=True", sql => sql.UseNetTopologySuite())
            .Options;
        return new AppDbContext(options);
    }

    [Fact]
    public void Marketplace_foreign_keys_use_declared_keys_instead_of_shadow_properties()
    {
        using var db = CreateContext();
        var shadowForeignKeys = db.Model.GetEntityTypes()
            .SelectMany(entity => entity.GetForeignKeys())
            .SelectMany(foreignKey => foreignKey.Properties)
            .Where(property => property.IsShadowProperty())
            .Select(property => $"{property.DeclaringType!.DisplayName()}.{property.Name}")
            .ToArray();
        Assert.Empty(shadowForeignKeys);
    }

    [Fact]
    public void Application_settings_use_the_explicit_singleton_key()
    {
        using var db = CreateContext();
        var id = db.Model.FindEntityType(typeof(AppSetting))!.FindProperty(nameof(AppSetting.Id))!;
        Assert.Equal(ValueGenerated.Never, id.ValueGenerated);
    }

    [Fact]
    public void Worker_owned_rows_reference_worker_profile_by_WorkerId()
    {
        using var db = CreateContext();
        foreach (var entity in new[] { typeof(Offering), typeof(AvailabilityWindow), typeof(AvailabilityException) })
        {
            var foreignKey = db.Model.FindEntityType(entity)!.GetForeignKeys().Single(fk => fk.PrincipalEntityType.ClrType == typeof(WorkerProfile));
            Assert.Equal(nameof(Offering.WorkerId), foreignKey.Properties.Single().Name);
        }
    }
}
