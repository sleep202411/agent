Pod::Spec.new do |s|
  s.name = 'FizzTimelineExport'
  s.version = '1.0.0'
  s.summary = 'Local FizzDragon timeline video composition'
  s.description = 'Native timeline encoding for the FizzDragon Mobile application.'
  s.license = { :type => 'Proprietary' }
  s.author = 'FizzDragon'
  s.homepage = 'https://fizzdragon.com'
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.source = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AVFoundation'
  s.source_files = '**/*.swift'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
