FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend
COPY src/frontend/package*.json ./
RUN npm ci
COPY src/frontend/ ./
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS backend-build
WORKDIR /src
COPY global.json ./
COPY DaqqaTid.slnx ./
COPY src/backend/DaqqaTid.Domain/DaqqaTid.Domain.csproj src/backend/DaqqaTid.Domain/
COPY src/backend/DaqqaTid.Application/DaqqaTid.Application.csproj src/backend/DaqqaTid.Application/
COPY src/backend/DaqqaTid.Infrastructure/DaqqaTid.Infrastructure.csproj src/backend/DaqqaTid.Infrastructure/
COPY src/backend/DaqqaTid.Api/DaqqaTid.Api.csproj src/backend/DaqqaTid.Api/
RUN dotnet restore src/backend/DaqqaTid.Api/DaqqaTid.Api.csproj
COPY src/backend/ src/backend/
COPY --from=frontend-build /app/frontend/dist/ src/backend/DaqqaTid.Api/wwwroot/
RUN dotnet publish src/backend/DaqqaTid.Api/DaqqaTid.Api.csproj --configuration Release --no-restore --output /out

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
COPY --from=backend-build /out/ ./
ENTRYPOINT ["dotnet", "DaqqaTid.Api.dll"]
