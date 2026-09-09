<?php
// Run once on an empty, dedicated Moodle tree/database. Secrets arrive on stdin.
declare(strict_types=1);
try {
    $input = json_decode(stream_get_contents(STDIN, 16385), true, 16, JSON_THROW_ON_ERROR);
    $source = realpath($argv[1] ?? '');
    $data = realpath($argv[2] ?? '');
    if (!$source || !$data || !is_dir($data) || str_starts_with($data . '/', $source . '/') ||
        !is_file($source . '/admin/cli/install_database.php') ||
        !is_file($source . '/public/version.php') ||
        !preg_match('/^[a-f0-9]{32}$/D', $input['instance'] ?? '') ||
        strlen($input['databasePassword'] ?? '') < 24 || strlen($input['adminPassword'] ?? '') < 24) {
        throw new RuntimeException('Invalid dedicated lab configuration');
    }
    $url = parse_url($input['baseUrl'] ?? '');
    if (!$url || isset($url['user']) || isset($url['pass']) || isset($url['query']) || isset($url['fragment']) ||
        !empty($url['path']) ||
        (($url['scheme'] ?? '') !== 'https' && !(($input['isolatedLoopbackTest'] ?? false) === true &&
            ($url['scheme'] ?? '') === 'http' && ($url['host'] ?? '') === '127.0.0.1'))) {
        throw new RuntimeException('Expected a lab origin');
    }
    $values = [
        'dbtype' => 'pgsql', 'dblibrary' => 'native', 'dbhost' => $input['databaseHost'] ?? '127.0.0.1',
        'dbname' => 'sb_moodle_lab', 'dbuser' => 'sb_moodle_lab', 'dbpass' => $input['databasePassword'],
        'prefix' => 'mdl_', 'dboptions' => ['dbpersist' => false, 'dbsocket' => false, 'dbport' => '5432'],
        'wwwroot' => $input['baseUrl'], 'dataroot' => $data, 'admin' => 'admin',
        'directorypermissions' => 0700, 'sb_lab_enabled' => true, 'sb_lab_instance' => $input['instance'],
        'noemailever' => true, 'noreplyaddress' => 'noreply@example.invalid', 'forcelogin' => true,
        'registerauth' => '', 'enrol_plugins_enabled' => 'manual', 'enablewebservices' => 0,
        'debug' => 0, 'debugdisplay' => false, 'sessioncookie' => 'SBMoodleLab',
        'disableupdatenotifications' => true, 'disableupdateautodeploy' => true,
    ];
    if (($input['trustedLocalTlsProxy'] ?? false) === true) {
        // Only for a loopback-bound origin behind the approved TLS tunnel.
        $values['sslproxy'] = true;
    }
    $config = "<?php\nunset(\$CFG);\nglobal \$CFG;\n\$CFG = new stdClass();\n";
    foreach ($values as $name => $value) {
        $config .= '$CFG->' . $name . ' = ' . var_export($value, true) . ";\n";
    }
    $config .= "require_once(__DIR__ . '/lib/setup.php');\n";
    umask(0077);
    $handle = fopen($source . '/config.php', 'x');
    if (!$handle || fwrite($handle, $config) !== strlen($config)) {
        throw new RuntimeException('Configuration write failed');
    }
    fclose($handle);
    // Keep the official Moodle installer, but do not put its password in OS argv.
    $argv = ['install_database.php', '--agree-license', '--fullname=Study Buddy Moodle Lab',
        '--shortname=SB-LAB', '--adminuser=sb-lab-admin', '--adminemail=admin@example.invalid',
        '--adminpass=' . $input['adminPassword']];
    $_SERVER['argv'] = $argv;
    $_SERVER['argc'] = count($argv);
    require($source . '/admin/cli/install_database.php');
} catch (Throwable $error) {
    fwrite(STDERR, "Dedicated Moodle bootstrap failed; existing configuration is never overwritten.\n");
    exit(1);
}
