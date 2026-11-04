FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY Sharing.Presentation.csproj .
RUN dotnet restore Sharing.Presentation.csproj
COPY Program.cs appsettings.json ./
COPY wwwroot ./wwwroot
RUN dotnet publish Sharing.Presentation.csproj -c Release --no-restore -o /out /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /out .
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
USER $APP_UID
ENTRYPOINT ["dotnet", "Sharing.Presentation.dll"]
