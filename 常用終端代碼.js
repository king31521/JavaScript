漫畫
(while true; do getevent -l | grep -m1 -E 'KEY_VOLUMEDOWN|KEY_VOLUMEUP' && pkill -f 'sh'; done) & end=$(($(date +%s) + 300)); while [ $(date +%s) -lt $end ]; do input swipe 540 1400 540 400 400; sleep 5; done; input swipe 540 400 540 1400 200; sleep 1; input swipe 540 400 540 1400 200; sleep 1; input swipe 540 400 540 1400 200; pkill -f 'sh'
左滑漫畫
(while true; do getevent -l | grep -m1 -E 'KEY_VOLUMEDOWN|KEY_VOLUMEUP' && pkill -f 'sh'; done) & end=$(($(date +%s) + 300)); while [ $(date +%s) -lt $end ]; do input swipe 872 960 208 960 400; sleep 5; done; input swipe 208 960 872 960 200; sleep 1; input swipe 208 960 872 960 200; sleep 1; input swipe 208 960 872 960 200; pkill -f 'sh'
hosts增加localhost
su -c "{ printf '127.0.0.1 localhost\n::1 ip6-localhost\n\n'; cat /etc/hosts; } > /tmp/hosts_tmp && cp /tmp/hosts_tmp /etc/hosts"
查詢hosts前5行
head -5 /etc/hosts
中止所有腳本
pkill -f 'sh'
